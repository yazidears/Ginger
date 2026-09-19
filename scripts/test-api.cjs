#!/usr/bin/env node
// Read-only local smoke checks. Network-heavy source calls are opt-in.
const assert = require('node:assert/strict');
const base = process.env.GINGER_TEST_URL || 'http://localhost:3002';
let passed = 0;
async function check(name, path, status, validate = () => {}) {
  const response = await fetch(new URL(path, base), {signal: AbortSignal.timeout(15000)});
  assert.equal(response.status, status, `${name}: HTTP ${response.status}, expected ${status}`);
  assert.match(response.headers.get('content-type') || '', /application\/json/, `${name}: JSON response required`);
  const body = await response.json();
  validate(body, response);
  console.log(`PASS ${name}`); passed++;
}
(async () => {
  for (const [name, query] of [
    ['missing coordinates', ''], ['missing longitude', '?lat=41'],
    ['non-numeric latitude', '?lat=no&lon=2'], ['latitude bounds', '?lat=91&lon=2'],
    ['longitude bounds', '?lat=41&lon=181'], ['blank latitude', '?lat=%20&lon=2'],
  ]) await check(name, `/api/assessment${query}`, 400, b => assert.equal(typeof b.error, 'string'));
  await check('invalid provider mode', '/api/providers?mode=invalid', 400);
  await check('negative scenario minute', '/api/scenario?minute=-1', 400);
  await check('scenario horizon limit', '/api/scenario?horizon=241', 400);
  await check('demo is explicitly labelled', '/api/scenario?minute=45&horizon=60', 200, b => {
    assert.equal(b.mode, 'demo'); assert.equal(b.scenario.minute, 45);
    assert.equal(b.scenario.perimeter.type, 'Polygon');
    assert.ok(Array.isArray(b.scenario.briefing.evidence) && b.scenario.briefing.evidence.length > 0);
  });
  await check('provider demo provenance', '/api/providers?mode=demo', 200, b => {
    assert.equal(b.operationalMode, 'demo'); assert.ok(b.providers.length > 0);
    b.providers.forEach(p => {assert.equal(p.status, 'demo'); assert.ok(p.detail); assert.ok(p.updatedAt);});
  });
  await check('unknown simulation ID', '/api/sage/runs/qa-nonexistent-run', 404, b => assert.ok(b.error));
  await check('watch-area persistence contract', '/api/watch-areas', 200, (b, r) => {
    assert.match(r.headers.get('cache-control') || '', /no-store/);
    assert.ok(Array.isArray(b.areas));
    for (const area of b.areas) {
      assert.equal(typeof area.id, 'string'); assert.equal(typeof area.name, 'string');
      assert.ok(Number.isFinite(area.lat) && Math.abs(area.lat) <= 90);
      assert.ok(Number.isFinite(area.lon) && Math.abs(area.lon) <= 180);
      assert.ok(area.radiusM >= 500 && area.radiusM <= 10000);
    }
  });
  await check('operations read contract', '/api/operations', 200, (b, r) => {
    assert.match(r.headers.get('cache-control') || '', /no-store/);
    assert.equal(b.version, 1);
    for (const key of ['tasks', 'observations', 'audit']) assert.ok(Array.isArray(b[key]));
    b.observations.forEach(o => {assert.equal(o.source, 'operator-entered'); assert.equal(o.verification, 'unverified');});
  });
  await check('AI configuration disclosure', '/api/sage', 200, b => {
    assert.equal(typeof b.configured, 'boolean');
    if (!b.configured) assert.equal(b.model, null);
    assert.ok(!('apiKey' in b) && !('token' in b));
  });
  if (process.env.GINGER_TEST_MONITOR === '1') {
    await check('monitor contract', '/api/monitor', 200, (b, r) => {
      assert.match(r.headers.get('cache-control') || '', /no-store/);
      assert.ok(Array.isArray(b.zones)); assert.ok(Array.isArray(b.deltas));
      for (const zone of b.zones) {
        assert.ok(['monitoring','review','escalating','unavailable'].includes(zone.state));
        assert.ok(Array.isArray(zone.reasons));
        assert.ok(zone.hotspots === null || Number.isInteger(zone.hotspots));
      }
    });
  }
  console.log(`${passed} API smoke checks passed against ${base}.`);
})().catch(error => {console.error(error.message); process.exitCode = 1;});
