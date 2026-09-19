import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {ChatInstance} from 'chat';
import type {ChannelHandler} from '@mastra/core/channels';
import {createiMessageAdapter} from '@photon-ai/chat-adapter-imessage';
import {createGingerAgent} from './agent';

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
    await handler(thread, message('HELP'), next, context); assert.match(String(posted[0]), /WATCH/);
    await handler(thread, message('What does a thermal detection mean?'), next, context); assert.equal(delegated, 1);
    await handler(thread, message(''), next, context); await handler(thread, message('WATCH Garraf', true), next, context);
    await handler({...thread, isDM: false}, message('WATCH Garraf'), next, context); assert.equal(posted.length, 1); assert.equal(delegated, 1);
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
