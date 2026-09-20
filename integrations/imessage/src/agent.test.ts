import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {ChatInstance} from 'chat';
import type {ChannelHandler} from '@mastra/core/channels';
import {createiMessageAdapter} from '@photon-ai/chat-adapter-imessage';
import {createGingerAgent} from './agent';
import {RequestContext} from '@mastra/core/request-context';
import type {Snapshot} from './updates';

test('Mastra handler binds subscriptions to the authenticated DM and ignores echoes, receipts and groups', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ginger-agent-'));
  const adapter = createiMessageAdapter({projectId: 'fixture-project', projectSecret: 'fixture-secret', webhookSecret: 'fixture-signing-secret'});
  mock.method(adapter as unknown as {ensureApp(): Promise<void>}, 'ensureApp', async () => {});
  const {agent, mastra} = createGingerAgent({adapter,
    model: {providerId: 'nebius', modelId: 'fixture-model', url: 'https://api.tokenfactory.nebius.com/v1', apiKey: 'fixture-key'},
    databaseUrl: `file:${join(dir, 'memory.db')}`, subscriptionsFile: join(dir, 'subscriptions.json'), readSnapshot: async () => null});
  try {
    await agent.getChannels()!.initialize(mastra);
    const handler = agent.getChannels()!.channelConfig.handlers!.onDirectMessage as ChannelHandler;
    const posted: unknown[] = []; let delegated = 0;
    const thread = {id: 'imessage:fixture', isDM: true, post: async (text: unknown) => {posted.push(text);}} as unknown as Parameters<ChannelHandler>[0];
    const message = (text: string, self = false) => ({id: text || 'receipt', text, author: {isMe: self}} as Parameters<ChannelHandler>[1]);
    const context = {} as Parameters<ChannelHandler>[3];
    const next = async () => {delegated++;};
    await handler(thread, message('HELP'), next, context); assert.match(String(posted[0]), /place or address/);
    await handler(thread, message('What does a thermal detection mean?'), next, context); assert.equal(delegated, 1);
    await handler(thread, message('watch Hospital de Sant Pau Barcelona'), next, context); assert.equal(delegated, 2);
    await handler(thread, message(''), next, context); await handler(thread, message('WATCH Garraf', true), next, context);
    await handler({...thread, isDM: false}, message('WATCH Garraf'), next, context); assert.equal(posted.length, 1); assert.equal(delegated, 2);
    for (let i = 0; i < 25; i++) await handler(thread, message('question-' + i), next, context);
    await handler(thread, message('STOP'), next, context); assert.match(String(posted.at(-1)), /Stopped/);
  } finally {await mastra.shutdown(); await rm(dir, {recursive: true, force: true});}
});
test('Photon rejects unsigned and invalidly signed webhook requests without sending', async () => {
  const adapter = createiMessageAdapter({projectId: 'fixture-project', projectSecret: 'fixture-secret', webhookSecret: 'fixture-signing-secret'});
  mock.method(adapter as unknown as {ensureApp(): Promise<void>}, 'ensureApp', async () => {});
  await adapter.initialize({} as ChatInstance);
  for (const headers of [new Headers(), new Headers({'X-Spectrum-Signature': 'invalid', 'X-Spectrum-Timestamp': String(Math.floor(Date.now() / 1000))})]) {
    const response = await adapter.handleWebhook(new Request('https://ginger.example/webhook', {method: 'POST', headers, body: '{}'}));
    assert.ok(response.status >= 400 && response.status < 500, `expected rejected verification, got ${response.status}`);
  }
});

test('natural-language evidence uses authenticated DM subscriptions and fails closed without channel context', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ginger-agent-evidence-'));
  const adapter = createiMessageAdapter({projectId: 'fixture-project', projectSecret: 'fixture-secret', webhookSecret: 'fixture-signing-secret'});
  const scan = new Date().toISOString();
  const snapshot: Snapshot = {lastScan: scan, deltas: [], zones: [
    {id: 'my-home', name: 'Resident garden', state: 'monitoring', hotspots: 0, windKmh: 10, reasons: ['Resident evidence'], updatedAt: scan},
    {id: 'other-area', name: 'Unrelated forest', state: 'escalating', hotspots: 8, windKmh: 70, reasons: ['Unrelated evidence'], updatedAt: scan},
  ]};
  const {agent, mastra, updates} = createGingerAgent({adapter,
    model: {providerId: 'nebius', modelId: 'fixture-model', url: 'https://api.tokenfactory.nebius.com/v1', apiKey: 'fixture-key'},
    databaseUrl: `file:${join(dir, 'memory.db')}`, subscriptionsFile: join(dir, 'subscriptions.json'), readSnapshot: async () => snapshot});
  try {
    await updates.command('imessage:resident', 'watch-mine', 'WATCH my-home');
    await updates.command('imessage:someone-else', 'watch-other', 'WATCH other-area');
    const {readWatchEvidence} = await agent.listTools();
    assert.ok(readWatchEvidence.execute);
    const requestContext = new RequestContext();
    requestContext.set('channel', {platform: 'imessage', eventType: 'message', isDM: true, threadId: 'imessage:resident', userId: 'resident'});
    const observe = {span: async <T>(_name: string, fn: () => T | Promise<T>) => fn(), log: () => {}};
    const scoped = await readWatchEvidence.execute({}, {requestContext, observe});
    assert.ok(scoped && typeof scoped === 'object' && 'evidence' in scoped && typeof scoped.evidence === 'string');
    assert.match(scoped.evidence, /Resident garden/);
    assert.doesNotMatch(scoped.evidence, /Unrelated forest|Unrelated evidence|70 km/);
    const unverified = await readWatchEvidence.execute({}, {requestContext: new RequestContext(), observe});
    assert.ok(unverified && typeof unverified === 'object' && 'evidence' in unverified && typeof unverified.evidence === 'string');
    assert.match(unverified.evidence, /No verified conversation/);
    assert.doesNotMatch(unverified.evidence, /Resident garden|Unrelated forest/);
  } finally {await mastra.shutdown(); await rm(dir, {recursive: true, force: true});}
});

test('location tools require the live authenticated message and confirm only in a later affirmative DM', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ginger-agent-actions-'));
  const {createResidentActions} = await import('./resident-actions');
  let saved = 0;
  const areas: Array<{id: string; name: string}> = [];
  const residentActions = createResidentActions({file: join(dir, 'locations.json'),
    searchLocations: async () => [{label: 'Hospital de Sant Pau, Barcelona', lat: 41.413, lon: 2.174}],
    addLocation: async input => {saved++; const area = {...input, id: 'hospital-fixture'}; areas.push(area); return area;}});
  const adapter = createiMessageAdapter({projectId: 'fixture-project', projectSecret: 'fixture-secret', webhookSecret: 'fixture-signing-secret'});
  mock.method(adapter as unknown as {ensureApp(): Promise<void>}, 'ensureApp', async () => {});
  const {agent, mastra, updates} = createGingerAgent({adapter, residentActions,
    model: {providerId: 'nebius', modelId: 'fixture-model', url: 'https://api.tokenfactory.nebius.com/v1', apiKey: 'fixture-key'},
    databaseUrl: `file:${join(dir, 'memory.db')}`, subscriptionsFile: join(dir, 'subscriptions.json'), readSnapshot: async () => null,
    readRegisteredAreas: async () => areas});
  try {
    await agent.getChannels()!.initialize(mastra);
    const handler = agent.getChannels()!.channelConfig.handlers!.onDirectMessage as ChannelHandler;
    const tools = await agent.listTools();
    const observe = {span: async <T>(_name: string, fn: () => T | Promise<T>) => fn(), log: () => {}};
    const context = (id: string, threadId = 'imessage:resident') => {
      const requestContext = new RequestContext();
      requestContext.set('channel', {platform: 'imessage', eventType: 'message', isDM: true, threadId, messageId: id, userId: 'resident'});
      return {requestContext, observe};
    };
    const posted: unknown[] = [];
    const thread = {id: 'imessage:resident', isDM: true, post: async (text: unknown) => {posted.push(text);}} as unknown as Parameters<ChannelHandler>[0];
    const turn = async (id: string, text: string, work: () => Promise<void>) => handler(thread,
      {id, text, author: {isMe: false}} as Parameters<ChannelHandler>[1], work, {} as Parameters<ChannelHandler>[3]);
    const call = async (tool: keyof typeof tools, args: Record<string, unknown>, id: string, threadId?: string) => {
      const result = await tools[tool].execute!(args as never, context(id, threadId));
      return result as Record<string, any>;
    };
    // A forged context alone cannot manufacture a user turn.
    await assert.rejects(() => call('searchWatchLocation', {query: 'Hospital de Sant Pau Barcelona'}, 'forged'), /authenticated direct message/);
    let pendingId = '';
    await turn('first', 'Please watch Hospital de Sant Pau Barcelona', async () => {
      const result = await call('searchWatchLocation', {query: 'Hospital de Sant Pau Barcelona'}, 'first');
      pendingId = result.candidates[0].pendingId;
      await assert.rejects(() => call('confirmWatchLocation', {pendingId}, 'first'), /explicitly confirm/);
      await assert.rejects(() => call('listWatchedLocations', {}, 'first', 'imessage:someone-else'), /authenticated direct message/);
    });
    assert.equal(saved, 0);
    await turn('second', 'Is that near the metro?', async () => {
      await assert.rejects(() => call('confirmWatchLocation', {pendingId}, 'second'), /explicitly confirm/);
    });
    await turn('third', 'Yes please', async () => {
      const result = await call('confirmWatchLocation', {pendingId}, 'third');
      assert.equal(result.subscribed, true);
    });
    assert.equal(saved, 1);
    assert.equal((await updates.listWatched(thread.id)).length, 1);
    await turn('fourth', 'please stop updates', async () => {throw new Error('Must not call the model to stop');});
    assert.equal((await updates.listWatched(thread.id)).length, 0);
    assert.match(String(posted.at(-1)), /Stopped/);
  } finally {await mastra.shutdown(); await rm(dir, {recursive: true, force: true});}
});
