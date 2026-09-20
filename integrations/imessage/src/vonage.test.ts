import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash, createHmac} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {ChatInstance, Message} from 'chat';
import {VonageWhatsAppAdapter} from './vonage';
import {createGingerAgent} from './agent';

const now = Date.parse('2026-09-20T10:00:00Z');
const token = 'fixture-private-webhook-token-123456789';
const fixture = {message_uuid: 'fixture-message-id', from: '34600000001', to: '34600000002', channel: 'whatsapp', message_type: 'text', text: 'HELP', timestamp: new Date(now).toISOString()};
function request(body: unknown = fixture, auth = token, headers?: HeadersInit, path = 'webhook') {
  return new Request(`https://ginger.example/api/agents/ginger-watch/channels/whatsapp/${path}?token=${auth}`, {method: 'POST', headers, body: JSON.stringify(body)});
}
async function setup(options: {signatureSecret?: string; fetch?: typeof fetch} = {}) {
  const messages: Message[] = []; const state = new Map<string, unknown>(); const sends: Record<string, unknown>[] = []; let clock = now;
  const adapter = new VonageWhatsAppAdapter({apiKey: 'fixture-key', apiSecret: 'fixture-secret', sender: fixture.to, webhookToken: token,
    now: () => clock, sleep: async ms => {clock += ms;}, fetch: async (_url, init) => {sends.push(JSON.parse(String(init?.body))); return Response.json({message_uuid: 'accepted-id'}, {status: 202});}, ...options});
  const chat = {getState: () => ({get: async (key: string) => state.get(key) ?? null, set: async (key: string, value: unknown) => {state.set(key, value);}}),
    processMessage: async (_adapter: unknown, _id: string, message: Message) => {messages.push(message);}} as unknown as ChatInstance;
  await adapter.initialize(chat);
  return {adapter, messages, sends, state, chat, advance: (ms: number) => {clock += ms;}};
}

test('WhatsApp rejects missing/incorrect webhook token, malformed payloads and wrong sender destinations', async () => {
  const {adapter, messages, sends} = await setup();
  assert.equal((await adapter.handleWebhook(request(fixture, ''))).status, 401);
  assert.equal((await adapter.handleWebhook(request(fixture, 'wrong'))).status, 401);
  assert.equal((await adapter.handleWebhook(request({...fixture, to: '34600000003'}))).status, 400);
  assert.equal((await adapter.handleWebhook(request({...fixture, from: '../recipient'}))).status, 400);
  assert.equal((await adapter.handleWebhook(request(null))).status, 400);
  assert.equal(messages.length, 0); assert.equal(sends.length, 0);
});

test('WhatsApp normalizes authenticated DMs and ignores status and non-text events', async () => {
  const {adapter, messages} = await setup();
  assert.equal((await adapter.handleWebhook(request())).status, 200);
  assert.equal(messages.length, 1); assert.equal(messages[0].threadId, `whatsapp:${fixture.to}:${fixture.from}`);
  assert.equal(messages[0].text, 'HELP'); assert.equal(messages[0].author.isMe, false);
  await adapter.handleWebhook(request({...fixture, status: 'delivered'}, token, undefined, 'status'));
  await adapter.handleWebhook(request({...fixture, message_type: 'image'}));
  await adapter.handleWebhook(request({...fixture, timestamp: new Date(now - 25 * 3600_000).toISOString()}));
  assert.equal(messages.length, 1);
});

test('WhatsApp sends only to authenticated conversations inside their 24-hour window', async () => {
  const {adapter, sends, advance} = await setup();
  const id = adapter.encodeThreadId({phone: fixture.from});
  await assert.rejects(adapter.postMessage(id, 'No opt-in'), /window is closed/);
  await adapter.handleWebhook(request());
  const result = await adapter.postMessage(id, 'Evidence update');
  assert.equal(result.id, 'accepted-id'); assert.deepEqual(sends[0], {from: fixture.to, to: fixture.from, channel: 'whatsapp', message_type: 'text', text: 'Evidence update'});
  advance(24 * 3600_000); await assert.rejects(adapter.postMessage(id, 'Expired'), /window is closed/);
  await assert.rejects(adapter.postMessage('imessage:someone', 'Wrong channel'), /Invalid WhatsApp conversation/);
  assert.equal(sends.length, 1);
});

test('WhatsApp provider failures do not pretend delivery; streaming emits one final message', async () => {
  const failed = await setup({fetch: async () => Response.json({error: 'rejected'}, {status: 429})});
  await failed.adapter.handleWebhook(request());
  await assert.rejects(failed.adapter.postMessage(failed.messages[0].threadId, 'Hello'), /429/);
  const {adapter, sends, messages} = await setup(); await adapter.handleWebhook(request());
  await adapter.stream(messages[0].threadId, (async function* () {yield 'Hello '; yield {type: 'markdown_text' as const, text: '**world**'};})());
  assert.equal(sends.length, 1); assert.equal(sends[0].text, 'Hello world');
});

test('configured Vonage signatures require matching JWT signature, account, payload and recent issue time', async () => {
  const signatureSecret = 'fixture-signature'; const {adapter, messages} = await setup({signatureSecret});
  const header = Buffer.from(JSON.stringify({alg: 'HS256', typ: 'JWT'})).toString('base64url');
  const sign = (body: unknown, apiKey = 'fixture-key', iat = now / 1000) => {
    const payload = Buffer.from(JSON.stringify({api_key: apiKey, iat, payload_hash: createHash('sha256').update(JSON.stringify(body)).digest('hex')})).toString('base64url');
    return `${header}.${payload}.${createHmac('sha256', signatureSecret).update(`${header}.${payload}`).digest('base64url')}`;
  };
  assert.equal((await adapter.handleWebhook(request())).status, 401);
  assert.equal((await adapter.handleWebhook(request({...fixture, text: 'STOP'}, token, {authorization: `Bearer ${sign(fixture)}`}))).status, 401);
  assert.equal((await adapter.handleWebhook(request(fixture, token, {authorization: `Bearer ${sign(fixture, 'other-account')}`}))).status, 401);
  assert.equal((await adapter.handleWebhook(request(fixture, token, {authorization: `Bearer ${sign(fixture, 'fixture-key', now / 1000 - 301)}`}))).status, 401);
  assert.equal((await adapter.handleWebhook(request(fixture, token, {authorization: `Bearer ${sign(fixture)}`}))).status, 200);
  assert.equal(messages.length, 1);
});

test('Vonage webhook reaches Mastra deterministic HELP without a model call and restart preserves reply window', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ginger-vonage-agent-')); const sent: string[] = [];
  function create() {
    const adapter = new VonageWhatsAppAdapter({apiKey: 'fixture-key', apiSecret: 'fixture-secret', sender: fixture.to, webhookToken: token, now: () => now, stateFile: join(dir, 'sessions.json'),
      fetch: async (_url, init) => {sent.push(JSON.parse(String(init?.body)).text); return Response.json({message_uuid: `accepted-${sent.length}`});}});
    return {adapter, ...createGingerAgent({adapter, model: {providerId: 'nebius', modelId: 'fixture-model', url: 'https://api.tokenfactory.nebius.com/v1', apiKey: 'fixture-key'},
      databaseUrl: `file:${join(dir, 'memory.db')}`, subscriptionsFile: join(dir, 'subscriptions.json'), readSnapshot: async () => null})};
  }
  let instance = create();
  try {
    await instance.agent.getChannels()!.initialize(instance.mastra);
    const tasks: Promise<unknown>[] = [];
    const response = await instance.agent.getChannels()!.handleWebhookEvent('whatsapp', request(), {waitUntil: task => {tasks.push(task);}});
    assert.equal(response.status, 200); await Promise.all(tasks); assert.match(sent[0], /place or address/);
    await instance.mastra.shutdown(); instance = create(); await instance.agent.getChannels()!.initialize(instance.mastra);
    await instance.adapter.postMessage(instance.adapter.encodeThreadId({phone: fixture.from}), 'Reply window persisted');
    assert.equal(sent[1], 'Reply window persisted');
  } finally {await instance.mastra.shutdown(); await rm(dir, {recursive: true, force: true});}
});
