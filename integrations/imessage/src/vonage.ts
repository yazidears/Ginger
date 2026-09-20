import {createHash, createHmac, timingSafeEqual} from 'node:crypto';
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {Message, parseMarkdown, toPlainText, markdownToPlainText} from 'chat';
import type {Adapter, AdapterPostableMessage, ChatInstance, FormattedContent, RawMessage, StreamChunk, WebhookOptions} from 'chat';

const phone = /^[1-9]\d{6,14}$/;
const windowMs = 24 * 60 * 60 * 1000;
const endpoint = 'https://messages-sandbox.nexmo.com/v1/messages';
type Inbound = {message_uuid: string; from: string; to: string; channel: 'whatsapp'; message_type: 'text'; text: string; timestamp: string};
export type VonageOptions = {apiKey: string; apiSecret: string; sender: string; webhookToken: string; signatureSecret?: string;
  stateFile?: string; fetch?: typeof fetch; now?: () => number; sleep?: (ms: number) => Promise<void>};

function equal(a: string, b: string): boolean {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** A sandbox-only, text-only adapter. Destinations must have sent an authenticated inbound DM. */
export class VonageWhatsAppAdapter implements Adapter< {phone: string}, unknown> {
  readonly name = 'whatsapp';
  readonly userName = 'AshConnect';
  readonly persistThreadHistory = true;
  readonly lockScope = 'channel' as const;
  readonly botUserId: string;
  private chat?: ChatInstance;
  private queue: Promise<unknown> = Promise.resolve();
  private stateQueue: Promise<unknown> = Promise.resolve();
  private inboundWindows: Record<string, number> = {};
  private lastSend = 0;
  private readonly now: () => number;
  constructor(private readonly options: VonageOptions) {
    if (!options.apiKey.trim() || !options.apiSecret.trim() || !phone.test(options.sender) || options.webhookToken.length < 32) {
      throw new Error('Vonage requires an API key, API secret, sender digits and a webhook token of at least 32 characters.');
    }
    this.botUserId = options.sender; this.now = options.now ?? Date.now;
  }
  async initialize(chat: ChatInstance) {
    this.chat = chat;
    if (this.options.stateFile) {
      try {
        const state = JSON.parse(await readFile(this.options.stateFile, 'utf8'));
        if (state.version !== 1 || !state.windows || typeof state.windows !== 'object' || Array.isArray(state.windows)
          || Object.entries(state.windows).some(([id, at]) => {try {this.decodeThreadId(id); return !Number.isFinite(at);} catch {return true;}})) throw new Error('Invalid WhatsApp session state');
        this.inboundWindows = state.windows;
      } catch (error) {if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;}
    }
  }
  private async rememberInbound(id: string, sentAt: number) {
    const operation = this.stateQueue.catch(() => {}).then(async () => {
      this.inboundWindows[id] = Math.max(this.inboundWindows[id] ?? 0, sentAt);
      for (const [key, at] of Object.entries(this.inboundWindows)) if (this.now() - at >= windowMs) delete this.inboundWindows[key];
      if (this.options.stateFile) {
        await mkdir(dirname(this.options.stateFile), {recursive: true, mode: 0o700});
        const temporary = `${this.options.stateFile}.tmp`;
        await writeFile(temporary, JSON.stringify({version: 1, windows: this.inboundWindows}), {mode: 0o600});
        await rename(temporary, this.options.stateFile);
      }
    });
    this.stateQueue = operation; await operation;
  }
  encodeThreadId(data: {phone: string}) {
    if (!phone.test(data.phone)) throw new Error('Invalid WhatsApp destination');
    return `whatsapp:${this.options.sender}:${data.phone}`;
  }
  decodeThreadId(id: string) {
    const prefix = `whatsapp:${this.options.sender}:`;
    const number = id.slice(prefix.length);
    if (!id.startsWith(prefix) || !phone.test(number)) throw new Error('Invalid WhatsApp conversation');
    return {phone: number};
  }
  channelIdFromThreadId(id: string) {this.decodeThreadId(id); return id;}
  isDM(id: string) {this.decodeThreadId(id); return true;}
  async fetchThread(id: string) {this.decodeThreadId(id); return {id, channelId: id, isDM: true, metadata: {}, channelVisibility: 'private' as const};}
  async fetchMessages() {return {messages: []};}
  renderFormatted(content: FormattedContent) {return toPlainText(content);}
  async startTyping() { /* Sandbox does not expose typing indicators. */ }
  async addReaction(): Promise<void> {throw new Error('WhatsApp sandbox reactions are unavailable');}
  async removeReaction(): Promise<void> {throw new Error('WhatsApp sandbox reactions are unavailable');}
  async deleteMessage(): Promise<void> {throw new Error('WhatsApp sandbox deletion is unavailable');}
  async editMessage(): Promise<RawMessage> {throw new Error('WhatsApp sandbox editing is unavailable');}
  parseMessage(value: unknown): Message {
    const raw = value as Inbound;
    return new Message({id: raw.message_uuid, threadId: this.encodeThreadId({phone: raw.from}), text: raw.text,
      formatted: parseMarkdown(raw.text), author: {userId: raw.from, userName: raw.from, fullName: raw.from, isBot: false, isMe: raw.from === this.options.sender},
      metadata: {dateSent: new Date(raw.timestamp), edited: false}, attachments: [], raw});
  }
  private authenticated(request: Request, body: string): boolean {
    // Sandbox webhook URLs support a private query token. Never print it or proxy access logs with query strings.
    if (!equal(new URL(request.url).searchParams.get('token') ?? '', this.options.webhookToken)) return false;
    if (!this.options.signatureSecret) return true;
    try {
      const token = request.headers.get('authorization')?.replace(/^Bearer /i, '') ?? '';
      const [header, payload, signature, extra] = token.split('.');
      if (extra || !signature || JSON.parse(Buffer.from(header, 'base64url').toString()).alg !== 'HS256') return false;
      const expected = createHmac('sha256', this.options.signatureSecret).update(`${header}.${payload}`).digest('base64url');
      if (!equal(signature, expected)) return false;
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
      const now = Math.floor(this.now() / 1000);
      return claims.api_key === this.options.apiKey && Number.isFinite(claims.iat) && claims.iat <= now + 60 && claims.iat >= now - 300
        && (claims.exp === undefined || (Number.isFinite(claims.exp) && claims.exp > now))
        && claims.payload_hash === createHash('sha256').update(body).digest('hex');
    } catch {return false;}
  }
  async handleWebhook(request: Request, options?: WebhookOptions): Promise<Response> {
    if (request.method !== 'POST') return new Response(null, {status: 405});
    const body = await request.text();
    if (body.length > 256_000) return new Response(null, {status: 413});
    if (!this.authenticated(request, body)) return new Response(null, {status: 401});
    let raw: Record<string, unknown>;
    try {raw = JSON.parse(body); if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error();}
    catch {return new Response(null, {status: 400});}
    // Delivery callbacks are acknowledgements only, never inbound commands or proof of phone delivery in the UI.
    if (new URL(request.url).pathname.endsWith('/status')) return new Response(null, {status: 200});
    if (raw.channel !== 'whatsapp' || raw.message_type !== 'text' || typeof raw.text !== 'string' || !raw.text.trim()) return new Response(null, {status: 200});
    if (typeof raw.from !== 'string' || !phone.test(raw.from) || raw.to !== this.options.sender || raw.from === this.options.sender
      || typeof raw.message_uuid !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(raw.message_uuid)
      || typeof raw.timestamp !== 'string' || !Number.isFinite(Date.parse(raw.timestamp))) return new Response(null, {status: 400});
    const sentAt = Date.parse(raw.timestamp);
    if (sentAt > this.now() + 60_000 || sentAt < this.now() - windowMs) return new Response(null, {status: 200});
    if (!this.chat) return new Response(null, {status: 503});
    const message = this.parseMessage(raw);
    await this.rememberInbound(message.threadId, sentAt);
    await this.chat.processMessage(this, message.threadId, message, options);
    return new Response(null, {status: 200});
  }
  async postMessage(threadId: string, message: AdapterPostableMessage): Promise<RawMessage> {
    const to = this.decodeThreadId(threadId).phone;
    let text: string;
    if (typeof message === 'string') text = message;
    else if ('raw' in message) text = message.raw;
    else if ('markdown' in message) text = markdownToPlainText(message.markdown);
    else if ('ast' in message) text = toPlainText(message.ast);
    else if ('fallbackText' in message && message.fallbackText) text = message.fallbackText;
    else throw new Error('WhatsApp sandbox supports text only');
    if (!text.trim()) throw new Error('Cannot send an empty WhatsApp message');
    // Keep one provider operation per logical update; partial multi-message sends would duplicate on retry.
    if (text.length > 4096) text = text.slice(0, 4000) + '\n[Truncated. Send STATUS for an individual area.]';
    const operation = this.queue.catch(() => {}).then(async () => {
      const lastInbound = this.inboundWindows[threadId];
      if (!lastInbound || this.now() - lastInbound >= windowMs) throw new Error('WhatsApp reply window is closed. The recipient must message AshConnect again.');
      const delay = Math.max(0, 1100 - (this.now() - this.lastSend));
      if (delay) await (this.options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms))))(delay);
      this.lastSend = this.now();
      const response = await (this.options.fetch ?? fetch)(endpoint, {method: 'POST', signal: AbortSignal.timeout(15_000),
        headers: {'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${this.options.apiKey}:${this.options.apiSecret}`).toString('base64')}`},
        body: JSON.stringify({from: this.options.sender, to, channel: 'whatsapp', message_type: 'text', text})});
      if (!response.ok) throw new Error(`Vonage rejected WhatsApp send (${response.status})`);
      const result = await response.json() as {message_uuid?: string};
      if (!result.message_uuid) throw new Error('Vonage did not acknowledge WhatsApp send');
      return {id: result.message_uuid, threadId, raw: result};
    });
    this.queue = operation; return operation;
  }
  async stream(threadId: string, chunks: AsyncIterable<string | StreamChunk>): Promise<RawMessage> {
    // WhatsApp cannot edit text in place: collect the model response and deliver once.
    let text = '';
    for await (const chunk of chunks) if (typeof chunk === 'string') text += chunk; else if (chunk.type === 'markdown_text') text += chunk.text;
    return this.postMessage(threadId, {markdown: text});
  }
}
