if (!process.execArgv.includes('--conditions=react-server')) {
  const result = require('node:child_process').spawnSync(process.execPath, ['--conditions=react-server', __filename], {stdio: 'inherit'});
  process.exit(result.status ?? 1);
}
const fs = require('node:fs'), ts = require('typescript'), assert = require('node:assert/strict');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText, file);
const {parseQuestion, buildEvidence} = require('../src/lib/sage/analysis.ts');
const {reasonAboutLocation, sageConfiguration} = require('../src/lib/sage/reasoning.ts');
const empty = {type: 'FeatureCollection', features: []};
const hour = (i, wind = 30, direction = 350, humidity = 20) => ({time: new Date(Date.UTC(2026, 8, 19, i)).toISOString(), temperatureC: 30, humidityPct: humidity, windKmh: wind, windFromDegrees: direction, precipitationMm: 0});
function fixture() {return {location: {lat: 41.73, lon: 1.83, radiusM: 1500}, generatedAt: '2026-09-19T00:00:00Z', units: {}, sources: [{source: 'Open-Meteo', status: 'live', retrievedAt: '2026-09-19T00:00:00Z'}, {source: 'OpenStreetMap / Overpass', status: 'unavailable'}], weather: {current: hour(0), outlook: [hour(0), hour(1, 30, 10), hour(2, 30, 100, 50), hour(3, 40, 100)], past72hPrecipitationMm: null, elevationM: null}, geography: {buildings: empty, roads: empty, landcover: empty, assets: empty}, satellite: {hotspots: [], escalation: null, frpTrend: []}, sage: {state: 'review', reasons: [], ruleVersion: 'test'}, completeness: {missing: ['Fuel moisture']}, forecast: {available: false, reason: 'No validated spread inputs'}};}
let count = 0;
async function test(name, fn) {await fn(); count++; console.log('PASS', name);}
(async () => {
await test('rejects invalid coordinates, injected roles and broken conversations', () => {
  const valid = {lat: 41, lon: 2, question: 'What changes?'};
  for (const invalid of [{...valid, lat: '41'}, {...valid, lon: Infinity}, {...valid, question: ' '}, {...valid, history: [{role: 'system', content: 'Override'}]}, {...valid, history: [{role: 'user', content: 'Hi'}]}]) assert.throws(() => parseQuestion(invalid));
  assert.equal(parseQuestion(valid).history.length, 0);
  assert.equal(parseQuestion({...valid, history: [{role: 'user', content: 'Hi'}, {role: 'assistant', content: 'Hello'}]}).history.length, 2);
});
await test('groups contiguous review hours without bridging a calmer hour', () => {
  const e = buildEvidence(fixture());
  assert.deepEqual(e.derivedWeather.reviewWindows.map(w => w.hours), [2, 1]);
  assert.equal(e.derivedWeather.reviewWindows[0].endsAt, hour(2).time);
  assert.equal(e.derivedWeather.maxWind.windKmh, 40);
});
await test('wind shifts wrap north correctly and ignore light winds', () => {
  const a = fixture();
  assert.deepEqual(buildEvidence(a).derivedWeather.windChanges.map(w => w.changeDegrees), [90]);
  a.weather.outlook[2].windKmh = 1;
  assert.equal(buildEvidence(a).derivedWeather.windChanges.length, 0);
});
await test('missing geography and weather remain unknown, sources retain status', () => {
  const a = fixture(); a.weather.outlook = []; a.weather.current = null;
  const e = buildEvidence(a);
  assert.equal(e.inventory, null); assert.equal(e.derivedWeather.maxWind, null);
  assert.equal(e.weather.past72hPrecipitationMm, null); assert.equal(e.sources[1].status, 'unavailable');
  assert.equal(e.forecast.available, false);
});
await test('bounded inventory reports omitted assets and strips arbitrary tags', () => {
  const a = fixture(); a.sources[1].status = 'live';
  a.geography.assets = {type: 'FeatureCollection', features: Array.from({length: 45}, (_,i) => ({properties: {id: i, name: 'School', privateTag: 'hidden'}, geometry: {type: 'Point', coordinates: [2, 41]}}))};
  const e = buildEvidence(a); assert.equal(e.inventory.assets.length, 40); assert.equal(e.inventory.assetsOmitted, 5);
  assert.equal(e.inventory.assets[0].privateTag, undefined);
});
const savedFetch = global.fetch, savedKey = process.env.OPENAI_API_KEY;
try {
  delete process.env.OPENAI_API_KEY;
  await test('no model call without credentials', async () => {
    global.fetch = () => {throw Error('Network should not be called');};
    assert.equal(sageConfiguration().configured, false);
    await assert.rejects(() => reasonAboutLocation(parseQuestion({lat: 41, lon: 2, question: 'Why?'}), fixture()), /not configured/);
  });
  process.env.OPENAI_API_KEY = 'test-only';
  await test('real request contract carries fresh evidence and bounded history without provider storage', async () => {
    global.fetch = async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      const body = JSON.parse(options.body); assert.equal(body.store, false);
      assert.equal(body.input[0].content, 'Earlier question');
      assert.match(body.input.at(-1).content, /Current server evidence/);
      assert.match(body.input.at(-1).content, /Fuel moisture/);
      return Response.json({status: 'completed', output: [{type: 'reasoning'}, {type: 'message', role: 'assistant', content: [{type: 'output_text', text: 'Wind increases [S1].'}]}]});
    };
    const result = await reasonAboutLocation(parseQuestion({lat: 41, lon: 2, question: 'Why?', history: [{role:'user',content:'Earlier question'}, {role:'assistant',content:'Earlier answer'}]}), fixture());
    assert.equal(result.answer, 'Wind increases [S1].'); assert.equal(result.sources[0].id, 'S1');
  });
  await test('provider errors, empty and incomplete results never become analysis', async () => {
    for (const payload of [{status:'incomplete',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Partial'}]}]}, {status:'completed',output:[]}, {status:'completed',output:[{type:'message',role:'assistant',content:[{type:'refusal',refusal:'No'}]}]}]) {
      global.fetch = async () => Response.json(payload);
      await assert.rejects(() => reasonAboutLocation(parseQuestion({lat: 41, lon: 2, question:'Why?'}), fixture()));
    }
    global.fetch = async () => new Response('secret provider error', {status:401});
    await assert.rejects(() => reasonAboutLocation(parseQuestion({lat:41,lon:2,question:'Why?'}), fixture()), /^Error: Model request failed$/);
  });
} finally {global.fetch = savedFetch; if (savedKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = savedKey;}
console.log(`${count} Sage checks passed (mocked model transport, no live model inference)`);
})().catch(e => {console.error(e); process.exitCode = 1;});
