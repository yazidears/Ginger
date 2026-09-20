import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createUpdates, status, type Snapshot} from './updates';

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'ginger-imessage-'));
  let now = Date.parse('2026-09-19T14:00:00Z');
  const iso = () => new Date(now).toISOString();
  const snapshot: Snapshot = {lastScan: iso(), zones: [{id: 'garraf', name: 'Garraf', state: 'monitoring', hotspots: 0, windKmh: 10, reasons: ['No configured rule met.'], updatedAt: iso()}, {id: 'bages', name: 'Bages', state: 'review', hotspots: null, windKmh: null, reasons: ['Evidence unavailable.'], updatedAt: iso()}], deltas: []};
  const file = join(dir, 'subscriptions.json');
  const create = () => createUpdates(file, async () => snapshot, () => now);
  const advance = (zoneId = 'garraf') => {now += 60_000; snapshot.lastScan = iso(); snapshot.deltas.unshift({id: iso() + zoneId, zoneId, time: iso(), area: zoneId, title: 'Wind changed', text: '10 → 20 km/h. Review evidence.'});};
  const elapse = (minutes: number) => {now += minutes * 60_000; snapshot.lastScan = iso(); for (const zone of snapshot.zones) zone.updatedAt = iso();};
  return {snapshot, file, create, advance, elapse, stale: () => {now += 21 * 60_000;}, cleanup: () => rm(dir, {recursive: true, force: true})};
}
test('opt-in excludes historical events; successful sends survive restart without duplicates', async () => {
  const f = await fixture(); try {
    f.advance(); const first = f.create();
    await first.command('imessage:user-a', 'watch-1', 'WATCH Garraf');
    const sent: string[] = []; const send = async (_id: string, text: string) => {sent.push(text);};
    await first.tick(send); assert.equal(sent.length, 0);
    f.advance(); await first.tick(send); assert.equal(sent.length, 1); assert.match(sent[0], /not an evacuation order or all-clear/);
    await f.create().tick(send); assert.equal(sent.length, 1);
  } finally {await f.cleanup();}
});
test('subscriptions are isolated; STOP persists and a replayed WATCH cannot resubscribe', async () => {
  const f = await fixture(); try {
    const updates = f.create();
    await updates.command('a', 'a-watch', 'WATCH Garraf'); await updates.command('b', 'b-watch', 'WATCH Bages');
    f.advance(); const recipients: string[] = [];
    await updates.tick(async id => {recipients.push(id);}); assert.deepEqual(recipients, ['a']);
    await updates.command('a', 'a-stop', 'STOP');
    assert.equal(await f.create().command('a', 'a-watch', 'WATCH Garraf'), '');
    f.advance(); await f.create().tick(async id => {recipients.push(id);}); assert.deepEqual(recipients, ['a']);
  } finally {await f.cleanup();}
});
test('failed sends retain their cursor and retry; successful recipients do not repeat', async () => {
  const f = await fixture(); try {
    const updates = f.create(); await updates.command('a', '1', 'WATCH Garraf'); await updates.command('b', '2', 'WATCH Garraf'); f.advance();
    const first = await updates.tick(async id => {if (id === 'b') throw new Error('network');}); assert.equal(first.sent, 1); assert.equal(first.failed, 1);
    const retried: string[] = []; await f.create().tick(async id => {retried.push(id);}); assert.deepEqual(retried, ['b']);
  } finally {await f.cleanup();}
});
test('stale or future snapshots never produce current alerts or an all-clear', async () => {
  const f = await fixture(); try {
    const updates = f.create(); await updates.command('a', '1', 'WATCH Garraf'); f.advance(); f.stale();
    assert.equal((await updates.tick(async () => {assert.fail('must not send');})).stale, true);
    assert.match(await updates.command('a', '2', 'STATUS') ?? '', /unavailable or stale/);
    f.snapshot.lastScan = '2099-01-01T00:00:00Z'; assert.equal((await updates.tick(async () => {assert.fail();})).stale, true);
  } finally {await f.cleanup();}
});
test('unknown area does not create a subscription; null evidence remains unknown', async () => {
  const f = await fixture(); try {
    const updates = f.create(); assert.match(await updates.command('a', '1', 'WATCH Unknown') ?? '', /not found/);
    f.advance(); assert.equal((await updates.tick(async () => {assert.fail();})).sent, 0);
    assert.match(status(f.snapshot, 'Bages', Date.parse(f.snapshot.lastScan!)), /Thermal evidence unavailable/);
    assert.equal(await updates.command('a', '2', 'What changed?'), null);
  } finally {await f.cleanup();}
});
test('corrupt subscription storage fails closed rather than losing opt-outs', async () => {
  const f = await fixture(); try {
    await writeFile(f.file, '{broken'); await assert.rejects(f.create().command('a', '1', 'WATCH Garraf'));
  } finally {await f.cleanup();}
});

test('repeat alerts require opt-in, are spaced five minutes apart, and cap at three reminders across restarts', async () => {
  const f = await fixture(); try {
    const u = f.create();
    await u.command('normal', '1', 'WATCH Garraf');
    await u.command('repeat', '2', 'WATCH garraf REPEAT');
    f.snapshot.zones[0].state = 'escalating'; f.snapshot.zones[0].hotspots = 2;
    const sent: {id: string; text: string}[] = [];
    const send = async (id: string, text: string) => {sent.push({id, text});};
    await u.tick(send); assert.equal(sent.length, 1); assert.equal(sent[0].id, 'repeat'); assert.match(sent[0].text, /HIGH · ESCALATING/);
    f.elapse(4); await f.create().tick(send); assert.equal(sent.length, 1);
    f.elapse(1); await f.create().tick(send); assert.equal(sent.length, 2); assert.match(sent[1].text, /reminder 1\/3/);
    for (let i = 0; i < 5; i++) {f.elapse(5); await f.create().tick(send);}
    assert.equal(sent.length, 4); assert.match(sent[3].text, /reminder 3\/3/);
  } finally {await f.cleanup();}
});
test('ACK is recipient-isolated, persists, keeps evidence updates, and rearms only on a new episode', async () => {
  const f = await fixture(); try {
    const u = f.create(); await u.command('a', '1', 'WATCH garraf REPEAT'); await u.command('b', '2', 'WATCH garraf REPEAT');
    f.snapshot.zones[0].state = 'escalating'; f.snapshot.zones[0].hotspots = 1;
    const recipients: string[] = []; const send = async (id: string) => {recipients.push(id);};
    await u.tick(send); assert.deepEqual(recipients, ['a', 'b']);
    await u.command('a', 'ack1', 'ACK'); f.elapse(5); await f.create().tick(send); assert.deepEqual(recipients, ['a', 'b', 'b']);
    f.advance(); await f.create().tick(send); assert.deepEqual(recipients.slice(-2), ['a', 'b']);
    // A temporary loss of coverage must not rearm acknowledged alerts.
    f.snapshot.zones[0].state = 'unavailable'; f.snapshot.zones[0].hotspots = null; f.elapse(5); await u.tick(send);
    f.snapshot.zones[0].state = 'escalating'; f.snapshot.zones[0].hotspots = 1; f.elapse(5);
    const before = recipients.filter(id => id === 'a').length; await f.create().tick(send);
    assert.equal(recipients.filter(id => id === 'a').length, before);
    f.snapshot.zones[0].state = 'monitoring'; f.snapshot.zones[0].hotspots = 0; f.elapse(1); await u.tick(send);
    f.snapshot.zones[0].state = 'escalating'; f.snapshot.zones[0].hotspots = 2; f.elapse(1); await f.create().tick(send);
    assert.equal(recipients.filter(id => id === 'a').length, before + 1);
    await u.command('a', 'stop', 'STOP'); f.elapse(5); const count = recipients.filter(id => id === 'a').length; await f.create().tick(send);
    assert.equal(recipients.filter(id => id === 'a').length, count);
  } finally {await f.cleanup();}
});
test('ACK before the first delivery suppresses reminders; plain WATCH disables repeat mode', async () => {
  const f = await fixture(); try {
    const u = f.create(); await u.command('a', '1', 'WATCH garraf REPEAT'); f.snapshot.zones[0].state = 'escalating';
    await u.command('a', '2', 'ACK'); assert.equal((await f.create().tick(async () => assert.fail())).sent, 0);
    await u.command('b', '3', 'WATCH garraf REPEAT'); await u.command('b', '4', 'WATCH garraf');
    assert.equal((await f.create().tick(async () => assert.fail())).sent, 0);
  } finally {await f.cleanup();}
});
test('stale zone evidence suppresses reminders; failures retry without spending the reminder allowance', async () => {
  const f = await fixture(); try {
    const u = f.create(); await u.command('a', '1', 'WATCH garraf REPEAT'); f.snapshot.zones[0].state = 'escalating';
    f.snapshot.zones[0].updatedAt = '2026-09-19T12:00:00Z';
    assert.equal((await u.tick(async () => assert.fail())).sent, 0);
    f.elapse(1); assert.equal((await u.tick(async () => {throw Error('provider failure');})).failed, 1);
    assert.equal((await f.create().tick(async () => {})).sent, 1);
    assert.equal((await f.create().tick(async () => assert.fail())).sent, 0);
    f.stale(); assert.equal((await u.tick(async () => assert.fail())).stale, true);
  } finally {await f.cleanup();}
});
test('duplicate names require an ID and deleting a watch stops its reminders', async () => {
  const f = await fixture(); try {
    f.snapshot.zones[1].name = 'Garraf'; const u = f.create();
    assert.match(await u.command('a', '1', 'WATCH Garraf REPEAT') ?? '', /More than one/);
    await u.command('a', '2', 'WATCH bages REPEAT'); f.snapshot.zones[1].state = 'escalating';
    f.snapshot.zones.pop(); assert.equal((await u.tick(async () => assert.fail())).sent, 0);
  } finally {await f.cleanup();}
});

test('STATUS uses only subscribed places, summarizes anonymous facts, and preserves unavailable evidence', async () => {
  const f = await fixture(); try {
    const inputs: string[] = [];
    const u = createUpdates(f.file, async () => f.snapshot, () => Date.parse(f.snapshot.lastScan!), undefined,
      async ({evidence}) => {inputs.push(evidence); return 'The available observations need continued monitoring.';});
    await u.command('a', 'watch-a', 'WATCH Garraf');
    await u.command('b', 'watch-b', 'WATCH Bages'); inputs.length = 0;
    const reply = await u.command('a', 'status-a', 'STATUS');
    assert.match(reply!, /available observations/); assert.match(reply!, /Garraf/); assert.doesNotMatch(reply!, /Bages/);
    assert.match(reply!, /0 unconfirmed thermal detections/); assert.match(reply!, /not an evacuation order or all-clear/);
    assert.equal(inputs.length, 1); assert.doesNotMatch(inputs[0], /Garraf|Bages|threadId/);
    assert.equal(JSON.parse(inputs[0])[0].windKmh, 10);
    const scopedToolEvidence = await u.evidence('a');
    assert.match(scopedToolEvidence, /Garraf/); assert.doesNotMatch(scopedToolEvidence, /Bages/);
    assert.equal(inputs.length, 1, 'evidence tool must not recursively invoke the summarizer');
    assert.match((await u.command('b', 'status-b', 'STATUS'))!, /thermal evidence unavailable.*wind unavailable/);
    assert.match((await u.command('new', 'status-new', 'STATUS'))!, /No saved places/);
    await u.command('a', 'stop-a', 'STOP');
    assert.match((await u.command('a', 'status-stopped', 'STATUS'))!, /No saved places/);
  } finally {await f.cleanup();}
});

test('summary failures fall back to concise facts and pending places do not borrow regional readings', async () => {
  const f = await fixture(); try {
    const registry = [...f.snapshot.zones, {id: 'pending', name: 'New demo place'}];
    const u = createUpdates(f.file, async () => f.snapshot, () => Date.parse(f.snapshot.lastScan!), async () => registry,
      async () => {throw new Error('Model unavailable');});
    await u.command('a', 'watch-a', 'WATCH Garraf');
    assert.match((await u.command('a', 'status-a', 'STATUS'))!, /wind 10 km\/h/);
    await u.command('b', 'watch-b', 'WATCH pending');
    const waiting = await u.command('b', 'status-b', 'STATUS');
    assert.match(waiting!, /Waiting for the first monitoring scan/); assert.doesNotMatch(waiting!, /Garraf|10 km/);
    f.advance(); const sent: string[] = [];
    await u.tick(async (_id, text) => {sent.push(text);});
    assert.equal(sent.length, 1); assert.match(sent[0], /Reply STOP/); assert.match(sent[0], /not an evacuation order or all-clear/);
  } finally {await f.cleanup();}
});

test('slow STATUS inference cannot hold the subscription lock or delay STOP', async () => {
  const f = await fixture(); let release!: (value: string | null) => void;
  let began!: () => void; const started = new Promise<void>(resolve => {began = resolve;});
  const deferred = new Promise<string | null>(resolve => {release = resolve;});
  try {
    const u = createUpdates(f.file, async () => f.snapshot, () => Date.parse(f.snapshot.lastScan!), undefined, async () => {began(); return deferred;});
    await u.command('a', 'watch', 'WATCH Garraf');
    const pending = u.command('a', 'status', 'STATUS'); await started;
    const stopped = await Promise.race([u.command('a', 'stop', 'STOP'), new Promise<string>(resolve => setTimeout(() => resolve('LOCKED'), 500))]);
    assert.match(stopped!, /Stopped/); release(null); await pending;
    assert.match((await u.command('a', 'after-stop', 'STATUS'))!, /No saved places/);
  } finally {release?.(null); await f.cleanup();}
});
