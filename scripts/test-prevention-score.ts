import assert from 'node:assert/strict';
import {activityContext, connectedFuelAreas, PREVENTION_METHOD, REFERENCE_TEAM, scorePrevention, validateTeam, type PreventionContext} from '../src/lib/receptivity/prevention';
import {ExposureIndex} from '../src/lib/exposure/model';
import type {ExposureDataset} from '../src/lib/exposure/types';
import type {CellResult, GridCell, Snapshot} from '../src/lib/receptivity/types';
import {mkdtemp, writeFile, utimes, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const conditions = {receptivity: [90, null], spread: [80, null]};
const context: PreventionContext = {humanActivity: 80, humanActivitySource: 'scenario', connectedFuelHa: 2000};
const score = (overrides: Partial<PreventionContext> = {}, team = {...REFERENCE_TEAM}, spread = 80, receptivity = 90) =>
  scorePrevention({receptivity: [receptivity], spread: [spread]}, {...context, ...overrides}, team);
assert.equal(score().status, 'scenario');
assert.equal(score().baselineRisk, 54.12);
assert.equal(score().residualRisk, 30.36);
assert.equal(score().preventionScore, 23.76);
assert.ok(score().preventionScore! > score({humanActivity: 10}).preventionScore!);
assert.ok(score().preventionScore! > score({}, {...REFERENCE_TEAM}, 10).preventionScore!);
assert.ok(score().preventionScore! > score({connectedFuelHa: 10}).preventionScore!);
assert.ok(score().preventionScore! > score({}, {...REFERENCE_TEAM}, 80, 10).preventionScore!);
assert.equal(score({}, {...REFERENCE_TEAM, coverage: 0}).preventionScore, 0);
assert.equal(score({}, {...REFERENCE_TEAM, arrivalMinutes: 60}).preventionScore, 0);
assert.equal(score({}, {...REFERENCE_TEAM, arrivalMinutes: 80}).preventionScore, 0);
assert.ok(score({}, {...REFERENCE_TEAM, arrivalMinutes: 30}).preventionScore! < score().preventionScore!);
assert.equal(score({humanActivity: 0}).preventionScore, 0, 'Human prevention does not erase background pressure');
assert.ok(score({humanActivity: 0}, {...REFERENCE_TEAM, spreadReduction: .5}).preventionScore! > 0);
assert.equal(score({}, {...REFERENCE_TEAM}, 80, 0).relativeReductionPct, null);
assert.equal(score({humanActivity: null}).preventionScore, null);
assert.equal(score({connectedFuelHa: null}).preventionScore, null);
assert.equal(scorePrevention(conditions, context, REFERENCE_TEAM, 1).preventionScore, null);
assert.equal(score({}, {...REFERENCE_TEAM}, NaN).status, 'insufficient-data');
assert.equal(score({}, {...REFERENCE_TEAM}, Infinity).status, 'insufficient-data');
for (const bad of [null, {}, {...REFERENCE_TEAM, coverage: 2}, {...REFERENCE_TEAM, coverage: '1'}, {...REFERENCE_TEAM, arrivalMinutes: -1}, {...REFERENCE_TEAM, opportunityMinutes: 0}, {...REFERENCE_TEAM, extra: 1}])
  assert.throws(() => validateTeam(bad));
for (let h = 0; h <= 100; h += 10) for (let s = 0; s <= 100; s += 10) {
  const result = score({humanActivity: h}, {...REFERENCE_TEAM, spreadReduction: .7}, s);
  assert.ok(result.preventionScore! >= 0 && result.preventionScore! <= 100);
  assert.ok(result.residualRisk! >= 0 && result.residualRisk! <= result.baselineRisk!);
  assert.ok(Math.abs(result.baselineRisk! - result.residualRisk! - result.preventionScore!) <= .011);
}
const cell = (x: number, y: number, fraction = 1): GridCell => ({id: `utm31-200-${x}-${y}`, center: [2, 41.5], ring: [], terrain: {},
  fuel: {type: 'Tree cover', burnableFraction: fraction, continuity: 1, fractions: {}, epoch: '2021', source: 'fixture'}});
const cells = [cell(0, 0), cell(200, 0, .5), cell(400, 200), cell(0, 1000)];
const extents = connectedFuelAreas(cells, 200);
assert.equal(extents.get(cells[0].id), 6);
assert.equal(extents.get(cells[1].id), 6);
assert.equal(extents.get(cells[2].id), 4, 'Diagonal cells do not connect');
assert.equal(extents.get(cells[3].id), 4);
assert.equal(connectedFuelAreas([{...cells[0], id: 'unknown'}], 200).size, 0);
assert.equal(connectedFuelAreas(cells, 100).size, 0);

const now = new Date().toISOString();
const dataset: ExposureDataset = {type: 'FeatureCollection', metadata: {version: 1, importedAt: now, sourceDate: now,
  source: 'fixture', sourceUrl: 'https://example.com', license: 'test', skipped: 0,
  counts: {road: 1, gathering: 0, complex: 0, healthcare: 0, school: 0},
  coverage: {type: 'MultiPolygon', coordinates: [[[[1, 41], [3, 41], [3, 42], [1, 42], [1, 41]]]]}},
  features: [{type: 'Feature', geometry: {type: 'Point', coordinates: [2, 41.5]},
    properties: {id: 'road-1', name: 'Road', category: 'road', kind: 'road', source: 'fixture', sourceUrl: 'https://example.com', occupancy: null}}]};
assert.ok(activityContext(cells[0], new ExposureIndex(dataset), 200).humanActivity! > 0);
assert.equal(activityContext(cells[0], null, 200).humanActivity, null);
assert.equal(activityContext(cells[0], new ExposureIndex({...dataset, metadata: {...dataset.metadata, skipped: 1}}), 200).humanActivity, null);
assert.equal(activityContext(cells[0], new ExposureIndex({...dataset, metadata: {...dataset.metadata, sourceDate: '2000-01-01'}}), 200).humanActivity, null);

async function routes() {
  const mapped: CellResult = {...cells[0], name: 'Test', stationId: 'station', stationDistanceKm: 1, confidence: .7,
    confidenceLabel: 'limited', velocity: null, ...conditions, prevention: score()};
  const snapshot = {generatedAt: now, observationRange: {oldest: now, newest: now}, horizons: [0, 1], cells: [mapped],
    stations: [{station: {id: 'station'}, frames: [{horizon: 0, timestamp: now}]}], preventionMethod: PREVENTION_METHOD} as Snapshot;
  const directory = await mkdtemp(join(tmpdir(), 'ginger-prevention-test-'));
  const previousDirectory = process.env.GINGER_RECEPTIVITY_DIR;
  const previousWorker = process.env.GINGER_EXTERNAL_WORKER;
  process.env.GINGER_RECEPTIVITY_DIR = directory;
  process.env.GINGER_EXTERNAL_WORKER = '1';
  let revision = 0;
  const save = async (value: Snapshot) => {
    const file = join(directory, 'latest.json');
    await writeFile(file, JSON.stringify(value));
    // Guarantee distinct revisions even on filesystems with coarse timestamp precision.
    const modified = new Date(Date.now() + ++revision * 1000);
    await utimes(file, modified, modified);
  };
  const body = {cellId: mapped.id, team: REFERENCE_TEAM};
  let POST: typeof import('../src/app/api/receptivity/prevention/route')['POST'];
  const post = (v: unknown) => POST(new Request('http://localhost/api/receptivity/prevention', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(v)}));
  try {
    await save(snapshot);
    ({POST} = await import('../src/app/api/receptivity/prevention/route'));
    const result = await post(body), data = await result.json();
    assert.equal(result.status, 200); assert.equal(data.score.preventionScore, 23.76);
    assert.equal(data.method.team.coverage, 1); assert.equal(data.validAt, now);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    const changed = await (await post({...body, humanActivity: 0})).json();
    assert.equal(changed.score.preventionScore, 0); assert.equal(changed.score.humanActivitySource, 'scenario');
    assert.equal((await (await post({...body, horizon: 1})).json()).score.status, 'insufficient-data');
    assert.equal((await post({...body, cellId: 'missing'})).status, 404);
    for (const invalid of [{...body, horizon: 2}, {...body, humanActivity: 101}, {...body, team: {}}, {...body, unexpected: 1}, []])
      assert.equal((await post(invalid)).status, 400);
    assert.equal((await POST(new Request('http://localhost', {method: 'POST', body: '{}'}))).status, 415);
    assert.equal((await POST(new Request('http://localhost', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{'}))).status, 400);
    assert.equal((await post({...body, padding: 'a'.repeat(4100)})).status, 413);
    await save({...snapshot, observationRange: {oldest: '2000-01-01', newest: now}});
    assert.equal((await post(body)).status, 503);
    await save({...snapshot, preventionMethod: undefined});
    assert.equal((await post(body)).status, 503);
    // Recover from an old snapshot after the external worker publishes a new file.
    await save(snapshot);
    assert.equal((await post(body)).status, 200);
  } finally {
    if (previousDirectory === undefined) delete process.env.GINGER_RECEPTIVITY_DIR;
    else process.env.GINGER_RECEPTIVITY_DIR = previousDirectory;
    if (previousWorker === undefined) delete process.env.GINGER_EXTERNAL_WORKER;
    else process.env.GINGER_EXTERNAL_WORKER = previousWorker;
    await rm(directory, {recursive: true, force: true});
  }
}
routes().then(() => console.log('Prevention score: model, missing data, connectivity, activity and API checks passed.')).catch(e => {console.error(e); process.exitCode = 1;});
