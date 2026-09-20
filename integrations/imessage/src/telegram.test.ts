import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {ChatInstance, Message} from 'chat';
import {TelegramAdapter} from './telegram';
import {createConnectApi} from './connect-api';
import {createUpdates} from './updates';
import {createGingerAgent} from './agent';

const incoming = {message_id: 4, date: 1_789_900_000, text: '/help', chat: {id: 456, type: 'private'}, from: {id: 456, is_bot: false, first_name: 'Resident'}};
async function setup(stateFile: string, handler?: (message: Message) => Promise<void>) {
  const messages: Message[] = []; const requests: {method: string; body: Record<string, unknown>}[] = [];
  let updates: unknown[] = []; let manual = false; let sendFailure = false;
  const adapter = new TelegramAdapter({token: '123:fixture-token', stateFile,
    fetch: async (url, init) => {
      const method = String(url).split('/').at(-1)!; const body = JSON.parse(String(init?.body)); requests.push({method, body});
      if (method === 'getMe') return Response.json({ok: true, result: {id: 123, is_bot: true, username: 'AshFixtureBot'}});
      if (method === 'getWebhookInfo') return Response.json({ok: true, result: {url: ''}});
      if (method === 'getUpdates') {
        if (!manual) return new Promise<Response>((_resolve, reject) => {
          const abort = () => reject(new Error('fixture abort'));
          init?.signal?.addEventListener('abort', abort, {once: true}); if (init?.signal?.aborted) abort();
        });
        return Response.json({ok: true, result: updates});
      }
      if (sendFailure) throw new Error(`fetch failed https://api.telegram.org/bot123:fixture-token/${method}`);
      return Response.json({ok: true, result: {message_id: 99, chat: {id: Number(body.chat_id)}}});
    }});
  await adapter.initialize({processMessage: async (_adapter: unknown, _id: string, message: Message) => {
    if (handler) await handler(message); messages.push(message);
  }} as unknown as ChatInstance);
  await adapter.startPolling(); await adapter.stopPolling(); manual = true;
  return {adapter, messages, requests, setUpdates: (value: unknown[]) => {updates = value;}, failSend: () => {sendFailure = true;}};
}

test('Telegram private commands and connection payload normalize, with persistent cursor', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ash-telegram-')); t.after(() => rm(dir, {recursive: true, force: true}));
  const file = join(dir, 'state.json'); const {adapter, messages, setUpdates, requests} = await setup(file);
  assert.equal(adapter.publicUsername, 'AshFixtureBot');
  setUpdates([{update_id: 10, message: incoming}, {update_id: 11, message: {...incoming, message_id: 5, text: `/start CONNECT_${'a'.repeat(32)}`}}]);
  await adapter.pollOnce();
  assert.deepEqual(messages.map(m => m.text), ['HELP', `CONNECT ${'a'.repeat(32)}`]);
  assert.equal(messages[0].threadId, 'telegram:123:456');
  assert.equal(JSON.parse(await readFile(file, 'utf8')).offset, 12);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  await adapter.pollOnce(); assert.equal(messages.length, 2);
  assert.equal(requests.at(-1)?.body.offset, 12);
});

test('Telegram ignores groups, bot senders, mismatched sender ids, and empty content', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ash-telegram-')); t.after(() => rm(dir, {recursive: true, force: true}));
  const {adapter, messages, setUpdates} = await setup(join(dir, 'state.json'));
  setUpdates([
    {update_id: 1, message: {...incoming, chat: {id: -456, type: 'group'}}},
    {update_id: 2, message: {...incoming, from: {id: 456, is_bot: true}}},
    {update_id: 3, message: {...incoming, from: {id: 789, is_bot: false}}},
    {update_id: 4, message: {...incoming, text: ''}},
    {update_id: 5, edited_message: incoming},
  ]);
  await adapter.pollOnce(); assert.equal(messages.length, 0);
  await assert.rejects(adapter.postMessage('telegram:123:456', 'No opt-in'), /first message/);
  assert.equal((await adapter.handleWebhook()).status, 405);
});

test('Telegram cursor advances only after successful processing and retries pending updates', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ash-telegram-')); t.after(() => rm(dir, {recursive: true, force: true}));
  const file = join(dir, 'state.json'); let fail = true;
  const {adapter, messages, setUpdates} = await setup(file, async () => {if (fail) throw new Error('handler failed');});
  setUpdates([{update_id: 10, message: incoming}]);
  await assert.rejects(adapter.pollOnce(), /handler failed/);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).offset, 0);
  fail = false; await adapter.pollOnce(); assert.equal(messages.length, 1);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).offset, 11);
});

test('Telegram restarts using disk state with a new Chat instance and buffers one final stream send', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ash-telegram-')); t.after(() => rm(dir, {recursive: true, force: true}));
  const file = join(dir, 'state.json'); const first = await setup(file);
  first.setUpdates([{update_id: 7, message: incoming}]); await first.adapter.pollOnce();
  const second = await setup(file); second.setUpdates([]); await second.adapter.pollOnce();
  assert.equal(second.requests.at(-1)?.body.offset, 8);
  const result = await second.adapter.stream('telegram:123:456', (async function* () {yield 'Hello '; yield {type: 'markdown_text' as const, text: '**world**'};})());
  assert.equal(result.id, '99'); const sends = second.requests.filter(r => r.method === 'sendMessage');
  assert.equal(sends.length, 1); assert.deepEqual(sends[0].body, {chat_id: '456', text: 'Hello world'});
  await assert.rejects(second.adapter.postMessage('telegram:124:456', 'wrong bot'), /Invalid Telegram/);
  await assert.rejects(second.adapter.postMessage('telegram:123:789', 'unknown'), /first message/);
  second.failSend(); await assert.rejects(second.adapter.postMessage('telegram:123:456', 'Fail safely'), error => {
    assert.equal((error as Error).message, 'Telegram sendMessage request failed'); return true;
  });
});

test('Telegram fails closed for invalid persisted state or bot identity', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ash-telegram-')); t.after(() => rm(dir, {recursive: true, force: true}));
  const file = join(dir, 'state.json'); await writeFile(file, '{bad json');
  await assert.rejects(setup(file), /Cannot load Telegram/);
  await rm(file);
  const adapter = new TelegramAdapter({token: '123:fixture-token', stateFile: file, fetch: async () => Response.json({ok: true, result: {id: 999, is_bot: true}})});
  await adapter.initialize({} as ChatInstance);
  await assert.rejects(adapter.startPolling(), /identity does not match/);
});

test('Telegram refuses an existing webhook without deleting it or starting polling', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ash-telegram-')); t.after(() => rm(dir, {recursive: true, force: true}));
  const calls: string[] = [];
  const adapter = new TelegramAdapter({token: '123:fixture-token', stateFile: join(dir, 'state.json'), fetch: async url => {
    const method = String(url).split('/').at(-1)!; calls.push(method);
    return Response.json({ok: true, result: method === 'getMe' ? {id: 123, is_bot: true, username: 'AshFixtureBot'} : {url: 'https://existing.example/webhook'}});
  }});
  await adapter.initialize({} as ChatInstance);
  await assert.rejects(adapter.startPolling(), /already has a webhook/);
  assert.deepEqual(calls, ['getMe', 'getWebhookInfo']); assert.equal(adapter.publicUsername, null);
});

test('Telegram token-only setup exposes the verified public username through the authenticated bridge', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ash-telegram-')); t.after(() => rm(dir, {recursive: true, force: true}));
  const {adapter} = await setup(join(dir, 'state.json'));
  const token = 'fixture-operator-token-at-least-32-characters';
  const api = createConnectApi({updates: createUpdates(join(dir, 'subscriptions.json'), async () => null), registeredIds: async () => [], send: async () => {}, token,
    channelInfo: () => ({channel: 'telegram', contact: adapter.publicUsername})});
  const response = await api(new Request('http://localhost/internal/ash-connect', {headers: {'x-ashconnect-token': token}}));
  const body = await response.json(); assert.equal(body.channel, 'telegram'); assert.equal(body.contact, 'AshFixtureBot');
  assert.equal(JSON.stringify(body).includes('fixture-token'), false);
});

test('a blocked Telegram recipient does not strand another resident STOP; transient sends retain their cursor', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ash-telegram-')); t.after(() => rm(dir, {recursive: true, force: true}));
  const stateFile = join(dir, 'state.json'); let manual = false; let rejection = 403;
  const delivered: string[] = []; const requestedOffsets: number[] = [];
  const updates = [{update_id: 10, message: incoming}, {update_id: 11, message: {...incoming, message_id: 5, text: '/stop', chat: {id: 789, type: 'private'}, from: {id: 789, is_bot: false}}}];
  const adapter = new TelegramAdapter({token: '123:fixture-token', stateFile, fetch: async (url, init) => {
    const method = String(url).split('/').at(-1)!; const body = JSON.parse(String(init?.body));
    if (method === 'getMe') return Response.json({ok: true, result: {id: 123, is_bot: true, username: 'AshFixtureBot'}});
    if (method === 'getWebhookInfo') return Response.json({ok: true, result: {url: ''}});
    if (method === 'getUpdates') {
      if (!manual) return new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(new Error('fixture abort'));
        init?.signal?.addEventListener('abort', abort, {once: true}); if (init?.signal?.aborted) abort();
      });
      requestedOffsets.push(body.offset); return Response.json({ok: true, result: updates});
    }
    if (body.chat_id === '456' && rejection) return Response.json({ok: false, error_code: rejection}, {status: rejection});
    delivered.push(body.text); return Response.json({ok: true, result: {message_id: 99, chat: {id: Number(body.chat_id)}}});
  }});
  const {agent, mastra, updates: subscriptions} = createGingerAgent({adapter,
    model: {providerId: 'nebius', modelId: 'fixture-model', url: 'https://api.tokenfactory.nebius.com/v1', apiKey: 'fixture-key'},
    databaseUrl: `file:${join(dir, 'mastra.db')}`, subscriptionsFile: join(dir, 'subscriptions.json'), readSnapshot: async () => null,
    readRegisteredAreas: async () => [{id: 'garraf', name: 'Garraf'}]});
  try {
    await agent.getChannels()!.initialize(mastra); await adapter.startPolling(); await adapter.stopPolling(); manual = true;
    await subscriptions.command('telegram:123:789', 'seed-watch', 'WATCH Garraf');
    assert.equal((await subscriptions.connectStatus()).counts.garraf, 1);
    // Retryable provider failures preserve the update, including the following resident's STOP.
    rejection = 503; await assert.rejects(adapter.pollOnce(), /503/);
    assert.equal(JSON.parse(await readFile(stateFile, 'utf8')).offset, 0);
    assert.equal((await subscriptions.connectStatus()).counts.garraf, 1);
    rejection = 429; await assert.rejects(adapter.pollOnce(), /429/);
    assert.equal(JSON.parse(await readFile(stateFile, 'utf8')).offset, 0);
    // A permanent recipient refusal advances past only that reply and processes STOP in the same poll.
    rejection = 403; await adapter.pollOnce();
    assert.equal(JSON.parse(await readFile(stateFile, 'utf8')).offset, 12);
    assert.equal((await subscriptions.connectStatus()).counts.garraf, undefined);
    assert.match(delivered.at(-1)!, /Stopped/);
    await adapter.pollOnce(); assert.equal(requestedOffsets.at(-1), 12);
    assert.equal(delivered.length, 1);
  } finally {await adapter.stopPolling(); await mastra.shutdown();}
});
