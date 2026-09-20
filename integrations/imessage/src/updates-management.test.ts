import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createUpdates, help, type Snapshot} from './updates';

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'ginger-management-')), file = join(dir, 'subscriptions.json');
  let now = Date.now();
  const snapshot: Snapshot = {lastScan: new Date(now).toISOString(), deltas: [], zones: ['garden', 'school'].map(id => ({id, name: id === 'garden' ? 'My garden' : 'Local school', state: 'monitoring', hotspots: 0, windKmh: 10, reasons: [], updatedAt: new Date(now).toISOString()}))};
  const create = () => createUpdates(file, async () => snapshot, () => now);
  return {file, snapshot, create, advance: () => {now += 5 * 60_000; snapshot.lastScan = new Date(now).toISOString(); for (const zone of snapshot.zones) zone.updatedAt = snapshot.lastScan;}, clean: () => rm(dir, {recursive: true, force: true})};
}

test('natural management defaults to no repeats and isolates single-place removal between residents', async () => {
  const f = await fixture(); try {
    const u = f.create();
    const reply = await u.subscribe('a', 'add-garden', 'garden');
    assert.match(reply, /Watching My garden/); assert.match(reply, /Repeated reminders are off/);
    assert.doesNotMatch(reply, /\bWATCH\b|\bSTATUS\b|\bACK\b/);
    await u.subscribe('a', 'add-school', 'school', {repeat: true});
    await u.subscribe('b', 'add-school', 'school');
    assert.deepEqual(await u.listWatched('a'), [{id: 'garden', name: 'My garden', repeat: false}, {id: 'school', name: 'Local school', repeat: true}]);
    assert.deepEqual(await u.listWatched('b'), [{id: 'school', name: 'Local school', repeat: false}]);
    assert.match(await u.unsubscribe('a', 'remove-school', 'school'), /other saved places still receive/);
    assert.deepEqual((await f.create().listWatched('a')).map(p => p.id), ['garden']);
    assert.deepEqual((await f.create().listWatched('b')).map(p => p.id), ['school']);
    assert.match(await u.unsubscribe('a', 'remove-unwatched', 'school'), /not watching that place/);
    await u.unsubscribe('a', 'stop-all'); assert.deepEqual(await f.create().listWatched('a'), []);
    assert.equal((await f.create().listWatched('b')).length, 1);
  } finally {await f.clean();}
});

test('natural actions share persistent idempotence with legacy commands and serialize STOP', async () => {
  const f = await fixture(); try {
    const u = f.create();
    await Promise.all([u.subscribe('a', 'add', 'garden'), u.unsubscribe('a', 'stop')]);
    assert.deepEqual(await u.listWatched('a'), []);
    assert.match(await f.create().subscribe('a', 'add', 'garden'), /already been handled/);
    assert.equal(await f.create().command('a', 'add', 'WATCH garden'), '');
    assert.deepEqual(await f.create().listWatched('a'), []);
    await u.subscribe('a', 'new-add', 'garden');
    assert.match(await u.unsubscribe('a', 'stop'), /already been handled/);
    assert.equal((await u.listWatched('a')).length, 1, 'old STOP receipt cannot cancel a newer opt-in');
    for (let i = 0; i < 260; i++) await u.acknowledge('a', `ack-${i}`);
    const data = JSON.parse(await readFile(f.file, 'utf8'));
    assert.equal(Object.values(data.subscriptions).every((s: any) => s.receipts.length <= 256), true);
  } finally {await f.clean();}
});

test('natural acknowledgement halts only caller reminders while preserving its subscription', async () => {
  const f = await fixture(); try {
    const u = f.create();
    await u.subscribe('a', 'add-a', 'garden', {repeat: true});
    await u.subscribe('b', 'add-b', 'garden', {repeat: true});
    f.snapshot.zones[0].state = 'escalating';
    assert.match(await u.acknowledge('a', 'seen'), /Acknowledged/);
    const sent: string[] = [];
    await f.create().tick(async id => {sent.push(id);}); assert.deepEqual(sent, ['b']);
    assert.equal((await f.create().listWatched('a'))[0].repeat, true);
    assert.match(await f.create().acknowledge('a', 'seen'), /already been handled/);
    f.advance(); await u.tick(async id => {sent.push(id);}); assert.deepEqual(sent, ['b', 'b']);
  } finally {await f.clean();}
});

test('natural management rejects command-shaped IDs and retains bounded conversational onboarding', async () => {
  const f = await fixture(); try {
    const u = f.create();
    for (const bad of ['garden REPEAT', 'garden\nSTOP', '', 'a'.repeat(65)]) {
      await assert.rejects(u.subscribe('a', 'invalid', bad), /Invalid watch area ID/);
      await assert.rejects(u.unsubscribe('a', 'invalid', bad), /Invalid watch area ID/);
    }
    assert.match(await u.subscribe('a', 'name-instead-of-id', 'Garden'), /not found/);
    assert.deepEqual(await u.listWatched('a'), []);
    assert.match(help, /Tell me a place or address/); assert.doesNotMatch(help, /\bWATCH\b|\bSTATUS\b|\bACK\b/);
    const listed = await u.command('a', 'places', 'AREAS');
    assert.match(listed!, /1\. My garden\n2\. Local school/);
    assert.doesNotMatch(listed!, /Text WATCH/);
    const manyAreas = Array.from({length: 21}, (_, index) => ({id: `place-${index}`, name: `Place ${index}`}));
    const bounded = createUpdates(f.file, async () => f.snapshot, Date.now, async () => manyAreas);
    for (let i = 0; i < 20; i++) await bounded.subscribe('bounded', `add-${i}`, manyAreas[i].id);
    assert.match(await bounded.subscribe('bounded', 'overflow', manyAreas[20].id), /already watching 20 places/);
    assert.equal((await bounded.listWatched('bounded')).length, 20);
  } finally {await f.clean();}
});
