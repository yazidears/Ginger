if (!process.execArgv.includes('--conditions=react-server')) {const r = require('node:child_process').spawnSync(process.execPath, ['--conditions=react-server', __filename], {stdio: 'inherit'}); process.exit(r.status ?? 1);}
const fs = require('node:fs'), fsp = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8').replace(/from '@\//g, `from '${root}/src/`), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText, f);

(async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ginger-resident-locations-')), cwd = process.cwd(), oldFetch = global.fetch, oldToken = process.env.ASHCONNECT_OPERATOR_TOKEN;
  try {
    process.chdir(dir);
    const {createWatchAreaStore, watchAreaStore} = require(path.join(root, 'src/lib/watch-areas.ts'));
    const {createResidentLocations} = require(path.join(root, 'src/lib/resident-locations.ts'));
    const route = require(path.join(root, 'src/app/api/internal/resident-locations/route.ts'));
    const token = 'fixture-private-operator-token-32-characters'; process.env.ASHCONNECT_OPERATOR_TOKEN = token;
    const req = (body, supplied = token, type = 'application/json') => new Request('http://localhost/api/internal/resident-locations', {method: 'POST', headers: {'content-type': type, ...(supplied ? {'x-ashconnect-token': supplied} : {})}, body: typeof body === 'string' ? body : JSON.stringify(body)});
    const add = {action: 'add', requestId: 'resident-request-0001', name: 'Hospital demo', lat: 41.41, lon: 2.17, radiusM: 1000, placeType: 'hospital'};
    for (const badToken of [undefined, '', 'wrong', 'x'.repeat(token.length)]) {
      const request = req(add, badToken ?? ''); assert.equal((await route.POST(request)).status, 401);
    }
    delete process.env.ASHCONNECT_OPERATOR_TOKEN; assert.equal((await route.POST(req(add))).status, 401);
    process.env.ASHCONNECT_OPERATOR_TOKEN = 'short'; assert.equal((await route.POST(req(add, 'short'))).status, 401);
    process.env.ASHCONNECT_OPERATOR_TOKEN = token;
    assert.equal((await route.POST(req(add, token, 'text/plain'))).status, 415);
    assert.equal((await route.POST(req('{invalid'))).status, 400);
    assert.equal((await route.POST(req('x'.repeat(4097)))).status, 413);
    assert.equal((await route.POST(req(null))).status, 400);
    for (const patch of [{requestId: '../bad'}, {requestId: 123}, {name: '<script>'}, {name: 'x'.repeat(81)}, {lat: '41.41'}, {lat: 39}, {lon: 4}, {radiusM: 499}, {radiusM: 10001}, {radiusM: 500.5}, {placeType: 'office'}]) {
      assert.equal((await route.POST(req({...add, ...patch}))).status, 400, JSON.stringify(patch));
    }
    const results = await Promise.all(Array.from({length: 8}, () => route.POST(req(add))));
    for (const response of results) assert.equal(response.status, 200);
    const saved = await Promise.all(results.map(response => response.json()));
    const id = saved[0].area.id; assert.ok(saved.every(result => result.area.id === id));
    assert.equal((await watchAreaStore.list()).length, 7);
    assert.equal((await route.POST(req({...add, name: 'Different place'}))).status, 409);
    const file = path.join(dir, '.ginger-data/watch-areas.json');
    const restarted = createWatchAreaStore(file);
    assert.equal((await restarted.add(add, add.requestId)).id, id);
    assert.equal((await restarted.list()).some(area => 'requests' in area || 'requestId' in area), false);
    assert.equal((await fsp.stat(file)).mode & 0o777, 0o600);
    const persisted = JSON.parse(await fsp.readFile(file, 'utf8'));
    assert.equal(persisted.version, 1); assert.equal(persisted.requests.length, 1);
    assert.equal(JSON.stringify(persisted).includes(add.requestId), false);
    // An ambiguous response after the commit must be retried without allocating a second place.
    const ambiguous = {...add, requestId: 'resident-request-0002', name: 'Second place'};
    const interrupted = createResidentLocations({store: {add: async (value, requestId) => {await restarted.add(value, requestId); throw new Error('Lost response after commit');}}});
    await assert.rejects(interrupted(ambiguous), /Lost response/);
    const recovered = await createResidentLocations({store: createWatchAreaStore(file)})(ambiguous);
    assert.equal((await restarted.list()).filter(area => area.name === ambiguous.name).length, 1);
    assert.equal(recovered.area.name, ambiguous.name);
    await restarted.add({name: 'Legacy caller', lat: 41, lon: 2, radiusM: 500});
    await restarted.remove(recovered.area.id);
    assert.equal((await route.POST(req(ambiguous))).status, 409);
    assert.equal((await route.POST(req(add))).status, 200);
    // Old schema v1 documents remain readable, and unrelated writes preserve receipts.
    const legacyFile = path.join(dir, 'legacy.json'); await fsp.writeFile(legacyFile, JSON.stringify({version: 1, areas: []}));
    const legacy = createWatchAreaStore(legacyFile); assert.deepEqual(await legacy.list(), []);
    await legacy.add(add, add.requestId); await legacy.add({...add, name: 'Ordinary add'});
    assert.equal(JSON.parse(await fsp.readFile(legacyFile, 'utf8')).requests.length, 1);
    const corrupt = JSON.stringify({version: 1, areas: [], requests: [{key: 'invalid'}]});
    await fsp.writeFile(legacyFile, corrupt); await assert.rejects(legacy.list());
    assert.equal(await fsp.readFile(legacyFile, 'utf8'), corrupt);
    let calls = 0, at = 10000;
    const feature = (name, lat, lon, props = {}) => ({geometry: {type: 'Point', coordinates: [lon, lat]}, properties: {name, ...props}});
    const search = createResidentLocations({now: () => at, fetch: async (url, init) => {
      calls++; assert.equal(new URL(url).searchParams.get('bbox'), '0.1,40.4,3.4,42.9'); assert.equal(init.cache, 'no-store');
      return Response.json({features: [feature('Hospital fixture', 41.41, 2.17, {osm_key: 'amenity', osm_value: 'hospital'}), feature('Outside region', 48, 2), feature('<Unsafe>\nlabel', 41.4, 2.2)]});
    }});
    const first = await search({action: 'search', query: 'Barcelona hospital'});
    assert.equal(first.locations.length, 2); assert.equal(first.locations[0].placeType, 'hospital'); assert.equal(first.locations[1].label, 'Unsafe  label');
    await search({action: 'search', query: 'Barcelona hospital'}); assert.equal(calls, 1);
    await assert.rejects(search({action: 'search', query: 'Girona hospital'}), error => error.status === 429);
    at += 1501; await search({action: 'search', query: 'Girona hospital'}); assert.equal(calls, 2);
    for (const query of ['', 'four', 'x'.repeat(251), 'bad\nquery']) await assert.rejects(search({action: 'search', query}), error => error.status === 400);
    global.fetch = async () => {throw new Error('private upstream error');};
    const offline = await route.POST(req({action: 'search', query: 'Unknown hospital'}));
    assert.equal(offline.status, 503); assert.equal(JSON.stringify(await offline.json()).includes('private upstream'), false);
    console.log('PASS resident locations: authorization, bounded JSON, Catalonia envelope, validation, concurrent/restart idempotency, lost-response retry, deleted retry rejection, backward-compatible registry, private receipts, corrupt-state rejection, geocoder filtering/cache/throttle and upstream failures');
  } finally {
    process.chdir(cwd); global.fetch = oldFetch;
    if (oldToken === undefined) delete process.env.ASHCONNECT_OPERATOR_TOKEN; else process.env.ASHCONNECT_OPERATOR_TOKEN = oldToken;
    await fsp.rm(dir, {recursive: true, force: true});
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
