import {Message, parseMarkdown, toPlainText, markdownToPlainText} from 'chat';
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Adapter, AdapterPostableMessage, ChatInstance, FormattedContent, RawMessage, StreamChunk} from 'chat';

type TelegramMessage = {message_id: number; date: number; text: string; chat: {id: number; type: string}; from: {id: number; is_bot: boolean; username?: string; first_name?: string}};
type Update = {update_id: number; message?: TelegramMessage};
export type TelegramOptions = {token: string; stateFile: string; fetch?: typeof fetch; onError?: (error: Error) => void};
const positiveId = /^[1-9]\d{0,15}$/;
type PersistentState = {version: 1; botId: string; offset: number; knownChats: string[]};
class TelegramRecipientUnavailableError extends Error {
  constructor() {super('Telegram recipient no longer permits bot messages'); this.name = 'TelegramRecipientUnavailableError';}
}

function command(text: string): string {
  const connect = /^\/start(?:@\w+)?\s+CONNECT_([a-f0-9]{32})\s*$/i.exec(text);
  if (connect) return `CONNECT ${connect[1]}`;
  const match = /^\/(start|help|stop|status|ack|watch|connect)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!match) return text;
  return `${match[1].toLowerCase() === 'start' ? 'HELP' : match[1].toUpperCase()}${match[2] ? ` ${match[2]}` : ''}`;
}

/** Token-authenticated Bot API polling; only previously observed private DMs can receive messages. */
export class TelegramAdapter implements Adapter<{chatId: string}, unknown> {
  readonly name = 'telegram';
  readonly persistThreadHistory = true;
  readonly lockScope = 'channel' as const;
  readonly botUserId: string;
  userName = 'AshConnect';
  private chat?: ChatInstance;
  private controller?: AbortController;
  private polling?: Promise<void>;
  private verified = false;
  get publicUsername(): string | null {return this.verified ? this.userName : null;}
  private saved: PersistentState;
  private writes: Promise<void> = Promise.resolve();
  constructor(private readonly options: TelegramOptions) {
    if (!/^[1-9]\d*:[A-Za-z0-9_-]+$/.test(options.token)) throw new Error('Telegram requires a valid bot token');
    this.botUserId = options.token.split(':')[0];
    if (!options.stateFile?.trim()) throw new Error('Telegram requires a persistent state file');
    this.saved = {version: 1, botId: this.botUserId, offset: 0, knownChats: []};
  }
  async initialize(chat: ChatInstance) {this.chat = chat;}
  encodeThreadId(data: {chatId: string}) {
    if (!positiveId.test(data.chatId)) throw new Error('Invalid Telegram private chat');
    return `telegram:${this.botUserId}:${data.chatId}`;
  }
  decodeThreadId(id: string) {
    const prefix = `telegram:${this.botUserId}:`; const chatId = id.slice(prefix.length);
    if (!id.startsWith(prefix) || !positiveId.test(chatId)) throw new Error('Invalid Telegram conversation');
    return {chatId};
  }
  channelIdFromThreadId(id: string) {this.decodeThreadId(id); return id;}
  isDM(id: string) {this.decodeThreadId(id); return true;}
  async fetchThread(id: string) {this.decodeThreadId(id); return {id, channelId: id, isDM: true, metadata: {}, channelVisibility: 'private' as const};}
  async fetchMessages() {return {messages: []};}
  renderFormatted(content: FormattedContent) {return toPlainText(content);}
  async startTyping() {}
  async addReaction(): Promise<void> {throw new Error('Telegram reactions are not implemented');}
  async removeReaction(): Promise<void> {throw new Error('Telegram reactions are not implemented');}
  async deleteMessage(): Promise<void> {throw new Error('Telegram deletion is not implemented');}
  async editMessage(): Promise<RawMessage> {throw new Error('Telegram editing is not implemented');}
  async handleWebhook(): Promise<Response> {return new Response(null, {status: 405});}
  parseMessage(value: unknown): Message {
    const raw = value as TelegramMessage; const text = command(raw.text);
    return new Message({id: String(raw.message_id), threadId: this.encodeThreadId({chatId: String(raw.chat.id)}), text,
      formatted: parseMarkdown(text), author: {userId: String(raw.from.id), userName: raw.from.username ?? String(raw.from.id),
        fullName: raw.from.first_name ?? raw.from.username ?? String(raw.from.id), isBot: false, isMe: false},
      metadata: {dateSent: new Date(raw.date * 1000), edited: false}, attachments: [], raw});
  }
  private async api<T>(method: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const timeout = AbortSignal.timeout(method === 'getUpdates' ? 30_000 : 15_000);
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(`https://api.telegram.org/bot${this.options.token}/${method}`, {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout});
    } catch {throw new Error(`Telegram ${method} request failed`);} // Fetch errors can contain the token-bearing URL.
    // A blocked/deactivated recipient cannot be repaired by replaying this reply. Keep authentication,
    // rate-limit and server/network errors retryable; only a sendMessage 403 is terminal per recipient.
    if (method === 'sendMessage' && response.status === 403) throw new TelegramRecipientUnavailableError();
    if (!response.ok) throw new Error(`Telegram ${method} rejected (${response.status})`);
    let result: {ok?: boolean; result?: T};
    try {result = await response.json();} catch {throw new Error(`Telegram ${method} returned invalid JSON`);}
    if (result?.ok !== true || result.result === undefined) throw new Error(`Telegram ${method} was not acknowledged`);
    return result.result;
  }
  /** Resolves after getMe verification, while polling continues in the background. */
  async startPolling(): Promise<void> {
    if (this.controller) return;
    if (!this.chat) throw new Error('Initialize Telegram before polling');
    const controller = new AbortController(); this.controller = controller;
    try {
      try {
        const saved = JSON.parse(await readFile(this.options.stateFile, 'utf8')) as PersistentState;
        if (saved.version !== 1 || saved.botId !== this.botUserId || !Number.isSafeInteger(saved.offset) || saved.offset < 0
          || !Array.isArray(saved.knownChats) || saved.knownChats.some(id => typeof id !== 'string' || !positiveId.test(id))) {
          throw new Error('Telegram persistent state is invalid');
        }
        this.saved = saved;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Cannot load Telegram persistent state');
      }
      const me = await this.api<{id: number; is_bot: boolean; username?: string}>('getMe', {}, controller.signal);
      if (String(me.id) !== this.botUserId || me.is_bot !== true) throw new Error('Telegram bot identity does not match token');
      if (typeof me.username !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(me.username)) throw new Error('Telegram did not return a valid public bot username');
      const webhook = await this.api<{url: string}>('getWebhookInfo', {}, controller.signal);
      if (typeof webhook.url !== 'string') throw new Error('Telegram did not return valid webhook configuration');
      if (webhook.url) throw new Error('Telegram bot already has a webhook configured. Remove that webhook explicitly or use a separate bot before starting AshConnect polling.');
      this.verified = true; this.userName = me.username;
      if (!controller.signal.aborted) this.polling = this.pollLoop(controller.signal);
    } catch (error) {this.controller = undefined; throw error;}
  }
  async stopPolling(): Promise<void> {
    this.controller?.abort(); await this.polling; this.controller = undefined; this.polling = undefined;
  }
  private persist(): Promise<void> {
    const body = JSON.stringify(this.saved);
    const operation = this.writes.catch(() => {}).then(async () => {
      await mkdir(dirname(this.options.stateFile), {recursive: true, mode: 0o700});
      const temporary = `${this.options.stateFile}.${randomUUID()}.tmp`;
      await writeFile(temporary, body, {mode: 0o600, flag: 'wx'});
      await rename(temporary, this.options.stateFile);
    });
    this.writes = operation; return operation;
  }
  private async pollLoop(signal: AbortSignal): Promise<void> {
    let failures = 0;
    while (!signal.aborted) {
      try {await this.pollOnce(signal); failures = 0;}
      catch {
        if (signal.aborted) break;
        failures = Math.min(failures + 1, 5);
        // Never forward arbitrary upstream or handler errors, which can include secrets or message text.
        try {this.options.onError?.(new Error('Telegram polling failed; pending updates will be retried'));} catch {}
      }
      await new Promise<void>(resolve => {
        const done = () => {clearTimeout(timer); signal.removeEventListener('abort', done); resolve();};
        const timer = setTimeout(done, failures ? Math.min(30_000, 1000 * 2 ** failures) : 100);
        signal.addEventListener('abort', done, {once: true}); if (signal.aborted) done();
      });
    }
  }
  /** One bounded poll, exposed for deterministic verification. startPolling must verify identity first. */
  async pollOnce(signal?: AbortSignal): Promise<void> {
    if (!this.chat || !this.verified) throw new Error('Telegram is not initialized and verified');
    let offset = this.saved.offset;
    const updates = await this.api<Update[]>('getUpdates', {offset, timeout: 25, limit: 50, allowed_updates: ['message']}, signal);
    if (!Array.isArray(updates)) throw new Error('Telegram returned invalid updates');
    for (const update of updates) {
      if (signal?.aborted) break;
      if (!Number.isSafeInteger(update?.update_id) || update.update_id < 0) throw new Error('Telegram returned invalid update id');
      if (update.update_id < offset) continue;
      const raw = update.message;
      if (raw?.chat?.type === 'private' && Number.isSafeInteger(raw.chat.id) && raw.chat.id > 0
        && raw.from?.id === raw.chat.id && !raw.from.is_bot && String(raw.from.id) !== this.botUserId
        && Number.isSafeInteger(raw.message_id) && raw.message_id > 0 && Number.isFinite(raw.date)
        && typeof raw.text === 'string' && raw.text.trim()) {
        const message = this.parseMessage(raw);
        const chatId = String(raw.chat.id);
        if (!this.saved.knownChats.includes(chatId)) {
          this.saved.knownChats.push(chatId);
          try {await this.persist();} catch (error) {this.saved.knownChats = this.saved.knownChats.filter(id => id !== chatId); throw error;}
        }
        // Our durable offset owns deduplication. Chat's early in-memory dedupe would hide failed retries.
        try {await this.chat.processMessage(this, message.threadId, message, {deduplicate: false, propagateHandlerErrors: true});}
        catch (error) {
          if (!(error instanceof TelegramRecipientUnavailableError)) throw error;
          // One resident blocking the bot must not prevent another resident's STOP from being processed.
          // The command itself already ran; discard only its undeliverable reply and commit this update.
        }
      }
      // Commit after processing or a terminal recipient refusal. A crash between send and commit can duplicate a reply.
      offset = update.update_id + 1;
      const previous = this.saved.offset; this.saved.offset = offset;
      try {await this.persist();} catch (error) {this.saved.offset = previous; throw error;}
    }
  }
  async postMessage(threadId: string, message: AdapterPostableMessage): Promise<RawMessage> {
    const {chatId} = this.decodeThreadId(threadId);
    if (!this.verified || !this.saved.knownChats.includes(chatId)) throw new Error('Telegram recipient must first message this bot');
    let text: string;
    if (typeof message === 'string') text = message;
    else if ('raw' in message) text = message.raw;
    else if ('markdown' in message) text = markdownToPlainText(message.markdown);
    else if ('ast' in message) text = toPlainText(message.ast);
    else if ('fallbackText' in message && message.fallbackText) text = message.fallbackText;
    else throw new Error('Telegram supports text only');
    if (!text.trim()) throw new Error('Cannot send an empty Telegram message');
    if (text.length > 4096) text = text.slice(0, 4000) + '\n[Truncated. Send STATUS for an individual area.]';
    const result = await this.api<{message_id: number; chat?: {id: number}}>('sendMessage', {chat_id: chatId, text});
    if (!Number.isSafeInteger(result.message_id) || result.message_id <= 0 || String(result.chat?.id) !== chatId) throw new Error('Telegram did not acknowledge the destination message');
    return {id: String(result.message_id), threadId, raw: result};
  }
  async stream(threadId: string, chunks: AsyncIterable<string | StreamChunk>): Promise<RawMessage> {
    let text = '';
    for await (const chunk of chunks) if (typeof chunk === 'string') text += chunk; else if (chunk.type === 'markdown_text') text += chunk.text;
    return this.postMessage(threadId, {markdown: text});
  }
}
