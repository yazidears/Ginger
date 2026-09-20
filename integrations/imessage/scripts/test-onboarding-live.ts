/** Opt-in synthetic live model check. Never starts polling or contacts Telegram/location services. */
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {config} from 'dotenv';
import {markdownToPlainText, toPlainText, type AdapterPostableMessage, type RawMessage} from 'chat';
import {createGingerAgent} from '../src/agent';
import {imessageModel} from '../src/model';
import {TelegramAdapter} from '../src/telegram';
import {createResidentActions, type ResidentArea} from '../src/resident-actions';

if (!process.argv.includes('--live')) throw new Error('Pass --live to authorize the bounded synthetic Nebius calls.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
config({path: join(root, '.env.local'), quiet: true});
config({path: join(root, 'integrations/imessage/.env'), quiet: true});
const dir = await mkdtemp(join(tmpdir(), 'ashconnect-onboarding-'));
const captures: Array<{threadId: string; text: string}> = [];
class CaptureAdapter extends TelegramAdapter {
  async postMessage(threadId: string, message: AdapterPostableMessage): Promise<RawMessage> {
    const text = typeof message === 'string' ? message : 'raw' in message ? message.raw
      : 'markdown' in message ? markdownToPlainText(message.markdown) : 'ast' in message ? toPlainText(message.ast)
      : 'fallbackText' in message ? message.fallbackText ?? '' : '';
    captures.push({threadId, text});
    return {id: `synthetic-output-${captures.length}`, threadId, raw: {synthetic: true}};
  }
}
const adapter = new CaptureAdapter({token: '123:synthetic-not-a-real-token', stateFile: join(dir, 'telegram.json'),
  fetch: async () => {throw new Error('External messaging is prohibited in this harness');}});
const registry: ResidentArea[] = [];
const actionCalls: string[] = [];
const actions = createResidentActions({file: join(dir, 'pending.json'),
  searchLocations: async query => {
    actionCalls.push('search'); assert.match(query, /Sant\s*Pau/i);
    return [{label: 'Hospital de Sant Pau, Barcelona (synthetic test candidate)', lat: 41.4125, lon: 2.174, placeType: 'hospital'}];
  },
  addLocation: async input => {
    actionCalls.push('register'); assert.equal(input.radiusM, 1000);
    assert.equal(input.lat, 41.4125); assert.equal(input.lon, 2.174);
    const area: ResidentArea = {id: 'synthetic-hospital-sant-pau', name: input.name, lat: input.lat, lon: input.lon,
      radiusM: input.radiusM, placeType: input.placeType};
    registry.push(area); return area;
  }});
const app = createGingerAgent({adapter, model: imessageModel(), databaseUrl: `file:${join(dir, 'memory.db')}`,
  subscriptionsFile: join(dir, 'subscriptions.json'), readSnapshot: async () => null,
  readRegisteredAreas: async () => registry, residentActions: actions});
const turns: Array<{input: string; replies: string[]; elapsedMs: number; registered: number; watched: number}> = [];
let passed = false; let failure: string | undefined;
const threadId = 'telegram:123:456';
try {
  const channels = app.agent.getChannels()!;
  await channels.initialize(app.mastra);
  const inputs = ['Please watch Hospital Sant Pau in Barcelona for me.', 'Yes, that is correct.', 'What places am I watching?', 'Stop updates'];
  for (const [index, input] of inputs.entries()) {
    const message = adapter.parseMessage({message_id: index + 1, date: Math.floor(Date.now() / 1000), text: input,
      chat: {id: 456, type: 'private'}, from: {id: 456, is_bot: false, first_name: 'Synthetic Resident'}});
    const offset = captures.length; const start = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([channels.sdk!.processMessage(adapter, threadId, message), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Synthetic turn exceeded 45 seconds')), 45_000);
      })]);
    } finally {if (timer) clearTimeout(timer);}
    const watched = await app.updates.listWatched(threadId);
    const replies = captures.slice(offset).map(item => item.text);
    turns.push({input, replies, elapsedMs: Date.now() - start, registered: registry.length, watched: watched.length});
    console.log(JSON.stringify(turns.at(-1)));
    assert.ok(replies.some(text => text.trim()), 'Each turn must produce a complete captured reply');
    if (index === 0) {assert.equal(registry.length, 0, 'Search must not register'); assert.equal(watched.length, 0);
      assert.ok(await actions.latestPending(threadId), 'Actual model must call authenticated location search');}
    if (index === 1) {assert.equal(registry.length, 1, 'Confirmation must register once'); assert.equal(watched.length, 1, 'Confirmation must subscribe');}
    if (index === 2) {assert.match(replies.join(' '), /Sant Pau/i); assert.equal(watched.length, 1);}
    if (index === 3) assert.equal(watched.length, 0, 'Stop must unsubscribe');
  }
  assert.deepEqual(actionCalls, ['search', 'register']);
  passed = true;
} catch (error) {
  // Never echo provider request objects or credentials.
  failure = error instanceof assert.AssertionError ? error.message : error instanceof Error ? error.name : 'UnknownError';
  process.exitCode = 1;
} finally {
  await app.mastra.shutdown(); await rm(dir, {recursive: true, force: true});
  const out = process.env.ASHCONNECT_EVAL_OUTPUT || join(root, '.ginger-data/evaluations/onboarding-live.json');
  await mkdir(dirname(out), {recursive: true});
  await writeFile(out, JSON.stringify({synthetic: true, model: process.env.IMESSAGE_MODEL || process.env.NEBIUS_MODEL,
    realMessaging: false, realRegistry: false, actualChannelDefaultHandler: true, passed, failure, actionCalls, turns}, null, 2) + '\n', {mode: 0o600});
  console.log(JSON.stringify({passed, failure, report: out, turns: turns.length}));
}
