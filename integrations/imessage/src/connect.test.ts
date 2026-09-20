import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createUpdates, type Snapshot} from './updates';
import {authorized, createConnectApi} from './connect-api';

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'ash-connect-'));
  const file = join(dir, 'subscriptions.json');
  let now = Date.now();
  const snapshot: Snapshot = {lastScan: new Date(now).toISOString(), deltas: [], zones: ['home-a', 'home-b'].map(id => ({id, name: id, state: 'monitoring', hotspots: 0, windKmh: 10, reasons: [], updatedAt: new Date(now).toISOString()}))};
  const create = () => createUpdates(file, async () => snapshot, () => now);
  const updates = create();
  await updates.command('resident-a', 'a1', 'WATCH home-a');
  await updates.command('resident-a', 'a2', 'WATCH home-b');
  await updates.command('resident-b', 'b1', 'WATCH home-b');
  return {file, updates, create, advance: () => {now += 61_000;}, clean: () => rm(dir, {recursive: true, force: true})};
}

test('operator messages target only selected subscriptions and deduplicate multi-home residents', async () => {
  const f = await fixture(); try {
    const sent: string[] = [];
    const result = await f.updates.connectSend({id: randomUUID(), areaIds: ['home-a', 'home-b'], text: 'Monitoring update'}, async (id, text) => {sent.push(id); assert.match(text, /Reply STOP/);});
    assert.deepEqual(sent, ['resident-a', 'resident-b']); assert.equal(result.accepted, 2);
    const status = await f.updates.connectStatus();
    assert.deepEqual(status.counts, {'home-a': 1, 'home-b': 2});
    assert.equal(JSON.stringify(status).includes('resident-a'), false);
  } finally {await f.clean();}
});

test('STOP before operator send excludes a resident; new homes are not implicitly subscribed', async () => {
  const f = await fixture(); try {
    await f.updates.command('resident-a', 'stop', 'STOP');
    await assert.rejects(f.updates.connectSend({id: randomUUID(), areaIds: ['home-a'], text: 'Hello'}, async () => assert.fail()), /No opted-in/);
    await assert.rejects(f.updates.connectSend({id: randomUUID(), areaIds: ['new-home'], text: 'Hello'}, async () => assert.fail()), /No opted-in/);
    const sent: string[] = [];
    await f.updates.connectSend({id: randomUUID(), areaIds: ['home-b'], text: 'Hello'}, async id => {sent.push(id);});
    assert.deepEqual(sent, ['resident-b']);
  } finally {await f.clean();}
});

test('same send survives restart without duplication; conflicting reuse and rapid new sends fail', async () => {
  const f = await fixture(); try {
    const input = {id: randomUUID(), areaIds: ['home-a'], text: 'Hello'};
    await f.updates.connectSend(input, async () => {});
    assert.equal((await f.create().connectSend(input, async () => assert.fail())).accepted, 1);
    await assert.rejects(f.create().connectSend({...input, text: 'Changed'}, async () => assert.fail()), /different message/);
    await assert.rejects(f.create().connectSend({...input, id: randomUUID()}, async () => assert.fail()), /Wait one minute/);
  } finally {await f.clean();}
});

test('ambiguous provider errors are retained as unknown and never automatically resent', async () => {
  const f = await fixture(); try {
    const input = {id: randomUUID(), areaIds: ['home-a', 'home-b'], text: 'Hello'};
    const result = await f.updates.connectSend(input, async id => {if (id === 'resident-a') throw Error('Network timeout');});
    assert.equal(result.accepted, 1); assert.equal(result.unknown, 1);
    assert.deepEqual(await f.create().connectSend(input, async () => assert.fail()), result);
  } finally {await f.clean();}
});

test('bridge requires operator credentials and rejects deleted homes and invalid messages', async () => {
  const f = await fixture(); try {
    const token = 'test-key-'.repeat(5), sent: string[] = [];
    const api = createConnectApi({updates: f.updates, token, registeredIds: async () => ['home-a'], send: async id => {sent.push(id);}});
    const request = (body: unknown, key = token) => new Request('http://localhost/internal/ash-connect', {method: 'POST', headers: {'x-ashconnect-token': key}, body: JSON.stringify(body)});
    assert.equal(authorized('short', 'short'), false);
    assert.equal((await api(request({}, 'wrong'))).status, 401);
    assert.equal((await api(request({id: randomUUID(), areaIds: ['home-b'], text: 'Hi'}))).status, 409);
    assert.equal((await api(request({id: randomUUID(), areaIds: ['home-a'], text: ' '}))).status, 400);
    assert.equal((await api(request({id: randomUUID(), areaIds: ['home-a'], text: 'Hi'}))).status, 200);
    assert.deepEqual(sent, ['resident-a']);
  } finally {await f.clean();}
});

test('corrupt subscription storage fails closed without contacting provider', async () => {
  const f = await fixture(); try {
    await writeFile(f.file, '{broken');
    await assert.rejects(f.updates.connectSend({id: randomUUID(), areaIds: ['home-a'], text: 'Hi'}, async () => assert.fail()));
  } finally {await f.clean();}
});

test('enhanced status requires a real REPEAT subscription and clears on STOP', async () => {
  const f = await fixture(); try {
    assert.deepEqual((await f.updates.connectStatus()).enhancedCounts, {});
    await f.updates.command('resident-a', 'repeat', 'WATCH home-a REPEAT');
    assert.deepEqual((await f.updates.connectStatus()).enhancedCounts, {'home-a': 1});
    await f.updates.command('resident-a', 'stop-enhanced', 'STOP');
    assert.deepEqual((await f.updates.connectStatus()).enhancedCounts, {});
  } finally {await f.clean();}
});

test('a newly registered school can subscribe before its first scan and is removed on deletion', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'ash-new-school-'));
 try {
  const now = Date.now();
  const snapshot: Snapshot = {lastScan: new Date(now).toISOString(), zones: [], deltas: []};
  let areas = [{id:'new-school',name:'Fixture school'}];
  const updates = createUpdates(join(dir,'subscriptions.json'), async () => snapshot, () => now, async () => areas);
  assert.match(await updates.command('school-contact','signup','WATCH new-school REPEAT') || '', /Enhanced notifications enabled/);
  assert.match(await updates.command('school-contact','areas','AREAS') || '', /Fixture school/);
  await updates.tick(async () => assert.fail('No observations yet'));
  assert.equal((await updates.connectStatus()).enhancedCounts['new-school'], 1);
  areas = [];
  await updates.tick(async () => assert.fail('Deleted school'));
  assert.deepEqual((await updates.connectStatus()).counts, {});
 } finally {await rm(dir, {recursive:true,force:true});}
});
