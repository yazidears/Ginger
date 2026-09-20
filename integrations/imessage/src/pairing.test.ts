import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createUpdates, status, type Snapshot} from './updates';
import {createConnectApi} from './connect-api';

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'ash-pairing-'));
  let now = Date.now();
  const snapshot: Snapshot = {lastScan: new Date(now).toISOString(), deltas: [], zones: [{id: 'home-a', name: 'Home A', state: 'monitoring', hotspots: 0, windKmh: 10, reasons: [], updatedAt: new Date(now).toISOString()}]};
  const create = () => createUpdates(join(dir, 'subscriptions.json'), async () => snapshot, () => now);
  return {updates: create(), create, snapshot, advance: (ms: number) => {now += ms;}, clean: () => rm(dir, {recursive: true, force: true})};
}
const a = 'a'.repeat(64), b = 'b'.repeat(64);

test('another resident subscribing never confirms this browser; CONNECT confirms exact conversation', async () => {
  const f = await fixture(); try {
    const pair = await f.updates.createPairing(a, 'home-a', true);
    await f.updates.command('other-resident', 'watch-other', 'WATCH home-a');
    assert.equal((await f.updates.residentStatus(a)).registrations[0].subscribed, false);
    assert.deepEqual((await f.updates.residentStatus(b)).registrations, []);
    assert.match(await f.updates.command('my-resident', 'connect-1', `CONNECT ${pair.code}`) || '', /Watching Home A/);
    const registration = (await f.create().residentStatus(a)).registrations[0];
    assert.equal(registration.subscribed, true); assert.equal(registration.enhanced, true); assert.equal('code' in registration, false);
    assert.equal(JSON.stringify(registration).includes('my-resident'), false);
    await f.updates.command('my-resident', 'stop-1', 'STOP');
    assert.equal((await f.updates.residentStatus(a)).registrations[0].subscribed, false);
    assert.equal(await f.updates.command('my-resident', 'connect-1', `CONNECT ${pair.code}`), '');
    assert.equal((await f.updates.residentStatus(a)).registrations[0].subscribed, false);
  } finally {await f.clean();}
});

test('pair codes expire, cannot be stolen after consumption, and replacements revoke old codes', async () => {
  const f = await fixture(); try {
    const first = await f.updates.createPairing(a, 'home-a', false);
    f.advance(15 * 60_000);
    assert.match(await f.updates.command('resident', 'expired', `CONNECT ${first.code}`) || '', /expired/);
    const next = await f.updates.createPairing(a, 'home-a', false);
    assert.match(await f.updates.command('resident', 'old', `CONNECT ${first.code}`) || '', /expired/);
    await f.updates.command('resident', 'valid', `CONNECT ${next.code}`);
    assert.match(await f.updates.command('attacker', 'reuse', `CONNECT ${next.code}`) || '', /already used/);
    assert.deepEqual((await f.updates.connectStatus()).counts, {'home-a': 1});
  } finally {await f.clean();}
});

test('pairing bridge requires authentication and checks registered areas', async () => {
  const f = await fixture(); try {
    const api = createConnectApi({updates: f.updates, registeredIds: async () => ['home-a'], send: async () => {}, token: 't'.repeat(32)});
    const request = (body: unknown, token = 't'.repeat(32)) => new Request('http://localhost/internal/ash-connect', {method: 'POST', headers: {'x-ashconnect-token': token}, body: JSON.stringify(body)});
    assert.equal((await api(request({action: 'pair', session: a, areaId: 'home-a'}, ''))).status, 401);
    assert.equal((await api(request({action: 'pair', session: a, areaId: 'deleted'}))).status, 409);
    assert.equal((await api(request({action: 'pair', session: a, areaId: 'home-a', repeat: true}))).status, 200);
    const mine = await (await api(request({action: 'resident-status', session: a}))).json();
    assert.equal(mine.registrations.length, 1);
    const other = await (await api(request({action: 'resident-status', session: b}))).json();
    assert.deepEqual(other.registrations, []);
  } finally {await f.clean();}
});

test('a fresh snapshot cannot make stale or future-dated area evidence current', async () => {
  const f = await fixture(); try {
    const now = Date.now();
    f.snapshot.lastScan = new Date(now).toISOString();
    f.snapshot.zones[0].updatedAt = new Date(now - 21 * 60_000).toISOString();
    assert.match(status(f.snapshot, 'home-a', now), /evidence unavailable or stale/);
    assert.doesNotMatch(status(f.snapshot, 'home-a', now), /0 thermal detections/);
    f.snapshot.zones[0].updatedAt = new Date(now + 60_000).toISOString();
    assert.match(status(f.snapshot, 'home-a', now), /evidence unavailable or stale/);
  } finally {await f.clean();}
});
