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
  return {snapshot, file, create, advance, stale: () => {now += 21 * 60_000;}, cleanup: () => rm(dir, {recursive: true, force: true})};
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
