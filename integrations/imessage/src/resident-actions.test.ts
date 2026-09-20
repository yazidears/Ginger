import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createResidentActions, createResidentLocationBridge, confirmsResidentLocation, type AddResidentLocation} from './resident-actions';

const candidate = {label: 'Example street, Barcelona', lat: 41.39, lon: 2.17, placeType: 'home' as const};
async function fixture(t: {after: (fn: () => Promise<void>) => unknown}) {
  const dir = await mkdtemp(join(tmpdir(), 'ginger-resident-actions-')); t.after(() => rm(dir, {recursive: true, force: true}));
  const file = join(dir, 'pending.json'); let clock = 1_800_000_000_000; let searches = 0; const additions: AddResidentLocation[] = [];
  const options = {file, now: () => clock, searchLocations: async () => {searches++; return [candidate];},
    addLocation: async (input: AddResidentLocation) => {additions.push(input); return {...input, id: 'new-place'};}};
  return {file, options, create: () => createResidentActions(options), additions, searches: () => searches, advance: (ms: number) => {clock += ms;}};
}

test('location setup requires a later message in the same conversation and saves only the provider candidate', async t => {
  const f = await fixture(t); const actions = f.create();
  const found = await actions.search('imessage:resident-a', 'search-1', 'Example street Barcelona');
  assert.equal(found.confirmationRequired, true); assert.equal(found.subscribed, false); assert.equal(f.additions.length, 0);
  const id = found.candidates[0].pendingId;
  await assert.rejects(actions.confirm('imessage:resident-a', 'search-1', id, 'yes'), /new message/);
  await assert.rejects(actions.confirm('imessage:resident-b', 'yes-1', id, 'yes'), /not available in this conversation/);
  await assert.rejects(actions.confirm('imessage:resident-a', 'yes-1', 'invented-coordinates', 'yes'), /current search/);
  await assert.rejects(actions.confirm('imessage:resident-a', 'other-message', id, 'What is the weather?'), /explicitly confirm/);
  assert.equal(f.additions.length, 0);
  const saved = await actions.confirm('imessage:resident-a', 'yes-1', id, 'yes');
  assert.equal(saved.locationRegistered, true); assert.equal(saved.subscribed, false); assert.equal(saved.area.id, 'new-place');
  assert.equal(f.additions.length, 1); assert.equal(f.additions[0].lat, candidate.lat); assert.equal(f.additions[0].lon, candidate.lon);
  assert.equal(f.additions[0].radiusM, 1000); assert.equal((await stat(f.file)).mode & 0o777, 0o600);
  const raw = await readFile(f.file, 'utf8'); assert.equal(raw.includes('imessage:resident-a'), false);
});

test('actual confirmation text must be a clear affirmative or selection, not a question, correction or condition', () => {
  for (const text of ['yes', "Yes, that's my home!", 'do it', 'start watching that location', 'sí, por favor', 'Si', 'confirma', 'endavant', "D'acord", 'the first one']) assert.equal(confirmsResidentLocation(text), true, text);
  for (const text of ['no', 'yes but another street', 'si llueve', 'yes if it rains', 'yes, stop instead', 'can you confirm?', 'What is the status?', 'the second one', 'confirm; remove everything', '']) assert.equal(confirmsResidentLocation(text), false, text);
});

test('only the best usable regional candidate is proposed and pending details are conversation-isolated', async t => {
  const f = await fixture(t);
  f.options.searchLocations = async () => [{...candidate, lat: 51, lon: 0}, candidate, {...candidate, label: 'Another possible address'}];
  const actions = f.create(); const found = await actions.search('telegram:a', 'search', 'Example street Barcelona');
  assert.equal(found.candidates.length, 1); assert.equal(found.candidates[0].label, candidate.label);
  assert.deepEqual(await actions.latestPending('telegram:a'), found); assert.equal(await actions.latestPending('telegram:b'), null);
  await actions.confirm('telegram:a', 'yes', found.candidates[0].pendingId, 'yes');
  assert.equal(await actions.latestPending('telegram:a'), null);
});

test('completed confirmations survive restart without adding a duplicate location', async t => {
  const f = await fixture(t); const first = f.create();
  const found = await first.search('telegram:a', 'search', 'Example street Barcelona'); const id = found.candidates[0].pendingId;
  const saved = await first.confirm('telegram:a', 'yes', id, 'yes');
  f.advance(16 * 60_000);
  const replay = await f.create().confirm('telegram:a', 'yes', id, 'yes');
  assert.equal(replay.replayed, true); assert.equal(replay.requestId, saved.requestId); assert.equal(f.additions.length, 1);
  await assert.rejects(f.create().confirm('telegram:a', 'yes-after-stop', id, 'yes'), /earlier message/);
  assert.equal(f.additions.length, 1);
});

test('an ambiguous registration failure retries the same idempotency key after restart', async t => {
  const f = await fixture(t); let fail = true;
  const original = f.options.addLocation;
  f.options.addLocation = async input => {const saved = await original(input); if (fail) throw new Error('connection lost after accept'); return saved;};
  const actions = f.create(); const found = await actions.search('telegram:a', 'search', 'Example street Barcelona'); const id = found.candidates[0].pendingId;
  await assert.rejects(actions.confirm('telegram:a', 'yes', id, 'yes'), /connection lost/);
  await assert.rejects(f.create().confirm('telegram:a', 'different-yes', id, 'yes'), /earlier message/);
  assert.equal(f.additions.length, 1);
  fail = false; await f.create().confirm('telegram:a', 'yes', id, 'yes');
  assert.equal(f.additions.length, 2); assert.equal(f.additions[0].requestId, f.additions[1].requestId);
});

test('search replay is stable, new searches revoke old candidates, and unused suggestions expire', async t => {
  const f = await fixture(t); const actions = f.create();
  const first = await actions.search('telegram:a', 'search', 'Example street Barcelona');
  const again = await actions.search('telegram:a', 'search', 'Example street Barcelona');
  assert.deepEqual(again, first); assert.equal(f.searches(), 1);
  await assert.rejects(actions.search('telegram:a', 'search', 'Different street Barcelona'), /different location search/);
  await actions.search('telegram:a', 'search-2', 'Different street Barcelona');
  await assert.rejects(actions.confirm('telegram:a', 'yes', first.candidates[0].pendingId, 'yes'), /not available/);
  const current = await actions.search('telegram:a', 'search-3', 'Another street Barcelona'); f.advance(15 * 60_000);
  await assert.rejects(actions.confirm('telegram:a', 'yes-2', current.candidates[0].pendingId, 'yes'), /expired/);
  assert.equal(f.additions.length, 0);
});

test('the pending store is bounded and corrupted state fails closed', async t => {
  const f = await fixture(t); const actions = f.create();
  for (let index = 0; index < 100; index++) await actions.search(`telegram:${index}`, 'search', 'Example street Barcelona');
  await assert.rejects(actions.search('telegram:overflow', 'search', 'Example street Barcelona'), /capacity/);
  assert.equal(f.searches(), 100);
  await writeFile(f.file, '{corrupt');
  await assert.rejects(f.create().search('telegram:a', 'search', 'Example street Barcelona'), /has not been reset/);
  assert.equal(await readFile(f.file, 'utf8'), '{corrupt');
});

test('resident HTTP bridge is fixed to authenticated loopback and returns only validated results', async () => {
  const token = 'fixture-private-operator-token-with-enough-characters'; const calls: Array<{url: string; options: RequestInit}> = [];
  const bridge = createResidentLocationBridge({baseUrl: 'http://127.0.0.1:3000', token, fetch: async (url, options) => {
    calls.push({url: String(url), options: options!});
    const body = JSON.parse(String(options?.body));
    return Response.json(body.action === 'search' ? {locations: [candidate]} : {area: {...body, id: 'new-place'}});
  }});
  assert.deepEqual(await bridge.searchLocations('Example street Barcelona'), [candidate]);
  await bridge.addLocation({requestId: '8bfafc8c-af81-4b3a-a782-a10f836a1ae1', name: 'Example', lat: 41.39, lon: 2.17, radiusM: 1000});
  assert.equal(calls[0].url, 'http://127.0.0.1:3000/api/internal/resident-locations');
  assert.equal(new Headers(calls[0].options.headers).get('x-ashconnect-token'), token); assert.equal(calls[0].options.redirect, 'error');
  assert.equal(JSON.parse(String(calls[1].options.body)).action, 'add');
  for (const baseUrl of ['https://outside.example', 'http://127.0.0.1:3000/private', 'http://user:pass@127.0.0.1:3000', 'http://127.0.0.1:3000?secret=1']) {
    assert.throws(() => createResidentLocationBridge({baseUrl, token}), /loopback/);
  }
  const unavailable = createResidentLocationBridge({baseUrl: 'http://127.0.0.1:3000', token, fetch: async () => new Response(null, {status: 503})});
  await assert.rejects(unavailable.searchLocations('Example street Barcelona'), /not accepted \(503\)/);
});
