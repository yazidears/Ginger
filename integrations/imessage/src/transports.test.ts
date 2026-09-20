import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {Adapter} from 'chat';
import {createiMessageAdapter} from '@photon-ai/chat-adapter-imessage';
import {createTransportRouter, publicChannelInfo, transportPlan} from './transports';
import {createGingerAgent} from './agent';
import {TelegramAdapter} from './telegram';

const photon = {IMESSAGE_PROJECT_ID: 'fixture-project', IMESSAGE_PROJECT_SECRET: 'fixture-secret', IMESSAGE_WEBHOOK_SECRET: 'fixture-signature'};

test('Telegram remains primary and credentials alone never activate optional iMessage', () => {
  const env = {ASHCONNECT_TRANSPORT: 'telegram', TELEGRAM_BOT_TOKEN: 'fixture-token', ...photon};
  assert.deepEqual(transportPlan(env), {primary: 'telegram', transports: ['telegram']});
  assert.deepEqual(transportPlan({...env, ASHCONNECT_IMESSAGE_ENABLED: 'true'}), {primary: 'telegram', transports: ['telegram', 'imessage']});
  assert.deepEqual(transportPlan({...photon, ASHCONNECT_IMESSAGE_ENABLED: 'true'}), {primary: 'imessage', transports: ['imessage']});
  assert.throws(() => transportPlan({ASHCONNECT_TRANSPORT: 'telegram', TELEGRAM_BOT_TOKEN: 'fixture', ASHCONNECT_IMESSAGE_ENABLED: 'true'}), /Missing configuration: IMESSAGE_PROJECT_ID, IMESSAGE_PROJECT_SECRET, IMESSAGE_WEBHOOK_SECRET/);
});

test('operator and proactive sends preserve channel/recipient identity without primary fallback', async () => {
  const sent: Array<{channel: string; thread: string; text: string}> = [];
  const adapter = (name: string) => ({name,
    decodeThreadId: (thread: string) => {if (!new RegExp(`^${name}:[a-z]+$`).test(thread)) throw new Error('Invalid thread'); return thread;},
    postMessage: async (thread: string, text: string) => {sent.push({channel: name, thread, text});},
  }) as unknown as Adapter;
  const router = createTransportRouter([adapter('telegram'), adapter('imessage')]);
  await router.send('imessage:resident', 'iMessage evidence'); await router.send('telegram:resident', 'Telegram evidence');
  assert.deepEqual(sent, [{channel: 'imessage', thread: 'imessage:resident', text: 'iMessage evidence'}, {channel: 'telegram', thread: 'telegram:resident', text: 'Telegram evidence'}]);
  await assert.rejects(router.send('whatsapp:resident', 'must not reroute'), /no enabled messaging channel/);
  await assert.rejects(router.send('imessage:invalid:thread', 'must not send'), /Invalid thread/);
  assert.equal(sent.length, 2);
  assert.throws(() => createTransportRouter([adapter('imessage'), adapter('imessage')]), /Duplicate messaging channel/);
});

test('optional iMessage exposes only its exact POST webhook while Telegram polling stays private', () => {
  const adapter = (name: string) => ({name}) as Adapter;
  const single = createTransportRouter([adapter('telegram')]);
  const dual = createTransportRouter([adapter('telegram'), adapter('imessage')]);
  const path = '/api/agents/ginger-watch/channels/imessage/webhook';
  assert.equal(single.webhookChannel('POST', path), null); assert.equal(dual.webhookChannel('POST', path), 'imessage');
  for (const other of ['/internal/ash-connect', '/api/agents/ginger-watch/channels/telegram/webhook', path + '/extra', path + '/status']) assert.equal(dual.webhookChannel('POST', other), null);
  assert.equal(dual.webhookChannel('GET', path), null);
  assert.deepEqual(dual.channels, ['telegram', 'imessage']);
});

test('public channel metadata preserves the primary and lists only enabled adapters with valid contacts', () => {
  const adapter = (name: string) => ({name}) as Adapter;
  const contacts: Record<string, string | null> = {telegram: 'AshConnectBot', imessage: '+15555550123', whatsapp: '15555550124'};
  const enabled = [adapter('telegram'), adapter('imessage')];
  assert.deepEqual(publicChannelInfo(enabled, adapter => contacts[adapter.name]), {
    channel: 'telegram', contact: 'AshConnectBot', channels: [{channel: 'telegram', contact: 'AshConnectBot'}, {channel: 'imessage', contact: '+15555550123'}],
  });
  contacts.imessage = 'https://malicious.example';
  assert.deepEqual(publicChannelInfo(enabled, adapter => contacts[adapter.name]).channels, [{channel: 'telegram', contact: 'AshConnectBot'}]);
  contacts.telegram = null;
  assert.deepEqual(publicChannelInfo(enabled, adapter => contacts[adapter.name]), {channel: 'telegram', contact: null, channels: []});
});

test('one Mastra agent initializes Telegram and iMessage together and rejects unsigned iMessage without sending', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ginger-multichannel-'));
  const imessage = createiMessageAdapter({projectId: 'fixture-project', projectSecret: 'fixture-secret', webhookSecret: 'fixture-webhook-secret'});
  mock.method(imessage as unknown as {ensureApp(): Promise<void>}, 'ensureApp', async () => {});
  const sender = mock.method(imessage, 'postMessage', async () => {throw new Error('Must not send');});
  const telegram = new TelegramAdapter({token: '123:fixture-token', stateFile: join(dir, 'telegram.json'), fetch: async () => {throw new Error('Must not contact Telegram');}});
  const {agent, mastra} = createGingerAgent({adapter: telegram, additionalAdapters: [imessage],
    model: {providerId: 'nebius', modelId: 'fixture-model', url: 'https://api.tokenfactory.nebius.com/v1', apiKey: 'fixture-key'},
    databaseUrl: `file:${join(dir, 'mastra.db')}`, subscriptionsFile: join(dir, 'subscriptions.json'), readSnapshot: async () => null});
  try {
    await agent.getChannels()!.initialize(mastra);
    assert.deepEqual(Object.keys(agent.getChannels()!.adapters).sort(), ['imessage', 'telegram']);
    const response = await agent.getChannels()!.handleWebhookEvent('imessage', new Request('https://ginger.example/api/agents/ginger-watch/channels/imessage/webhook', {method: 'POST', body: '{}'}));
    assert.ok(response.status >= 400 && response.status < 500); assert.equal(sender.mock.calls.length, 0);
  } finally {await mastra.shutdown(); await rm(dir, {recursive: true, force: true});}
});
