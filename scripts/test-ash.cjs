const fs = require('node:fs');
const ts = require('typescript');
const assert = require('node:assert/strict');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, file);
const {buildAshReply} = require('../src/lib/ash.ts');
const now = Date.parse('2026-09-19T12:15:00Z');
const fixture = () => ({
  location: {lat:41.3,lon:1.86,radiusM:1500},
  sources: [{source:'Open-Meteo',status:'live',retrievedAt:'2026-09-19T12:10:00Z',detail:'Modelled'}, {source:'NASA FIRMS NOAA-20 VIIRS',status:'live',retrievedAt:'2026-09-19T12:10:00Z',detail:'Thermal detections'}],
  weather: {current:{time:'2026-09-19T12:00:00Z',temperatureC:28,humidityPct:32,windKmh:18,windFromDegrees:225}},
  satellite: {hotspots:[{provenance:{observedAt:'2026-09-19T11:00:00Z'}}, {provenance:{observedAt:'2026-09-18T11:00:00Z'}}]},
  completeness: {missing:['Validated fire perimeter']},
  forecast: {reason:'Validated inputs are missing.'}
});
let count = 0;
function test(name, fn) { fn(); count++; console.log('PASS',name); }
test('weather preserves values, units, direction and valid time', () => { const r = buildAshReply('What is the wind doing?',fixture(),now); assert.match(r.answer,/18 kilometres per hour, from 225 degrees north/); assert.match(r.answer,/12:00:00Z/); assert.equal(r.mode,'connected'); });
test('old source is marked stale and current metrics withheld', () => { const f=fixture();f.sources[0].retrievedAt='2026-09-19T10:00:00Z';const r=buildAshReply('weather',f,now);assert.equal(r.weather,null);assert.equal(r.sources[0].status,'stale');assert.match(r.answer,/unavailable or stale/); });
test('future or invalid source timestamps are not current', () => { for(const time of ['invalid','2026-09-20T12:00:00Z']) {const f=fixture();f.sources[0].retrievedAt=time;assert.equal(buildAshReply('wind',f,now).weather,null);} });
test('old model valid time is withheld even with fresh retrieval', () => { const f=fixture();f.weather.current.time='2026-09-19T10:00:00Z';assert.equal(buildAshReply('weather',f,now).weather,null); });
test('only last six hours count and fire confirmation is not invented', () => {const r=buildAshReply('Any fire detections?',fixture(),now);assert.equal(r.hotspots,1);assert.match(r.answer,/not confirmed fires/);});
test('unavailable satellite evidence is unknown rather than zero', () => {const f=fixture();f.sources[1].status='unavailable';const r=buildAshReply('satellite',f,now);assert.equal(r.hotspots,null);assert.match(r.answer,/unavailable/);});
test('route questions cannot be answered with incidental weather facts', () => {const r=buildAshReply('Is the route safe in this wind?',fixture(),now);assert.match(r.answer,/cannot establish a safe route/);});
test('unsupported questions do not fabricate crew or dispatch knowledge', () => {const r=buildAshReply('Where is my crew?',fixture(),now);assert.match(r.answer,/do not have crew positions/);});
console.log(`${count} Ash checks passed`);
// Exercise the actual HTTP handler without depending on external provider uptime.
const Module = require('node:module');
const originalLoad = Module._load;
let calls = 0;
Module._load = function(id, parent, isMain) {
  if(id === '@/lib/assessment') return {validateLocation(lat,lon) {if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)throw Error();}, async assessLocation() {calls++;return fixture();}};
  if(id === '@/lib/ash') return {buildAshReply};
  if(id === '@/lib/operations') return {readOperations:async()=>({version:1,tasks:[],observations:[],audit:[]})};
  if(id.startsWith('@/lib/')) return originalLoad.call(this,require.resolve('../src/lib/'+id.slice(6)+'.ts'),parent,isMain);
  return originalLoad.apply(this,arguments);
};
const {POST} = require('../src/app/api/ash/route.ts');
Module._load = originalLoad;
(async () => {
  for(const body of [null, {}, {question:'',lat:41.3,lon:1.86}, {question:'wind',lat:'41.3',lon:1.86}, {question:'wind',lat:91,lon:1.86}]) {
    const r=await POST(new Request('http://localhost/api/ash',{method:'POST',body:JSON.stringify(body)}));assert.equal(r.status,400);
  }
  const oversized=await POST(new Request('http://localhost/api/ash',{method:'POST',body:'x'.repeat(4097)}));assert.equal(oversized.status,413);
  assert.equal(calls,0,'invalid inputs must never call providers');
  const valid=await POST(new Request('http://localhost/api/ash',{method:'POST',body:JSON.stringify({question:'wind',lat:41.3,lon:1.86})}));
  assert.equal(valid.status,200);assert.equal(valid.headers.get('cache-control'),'no-store');assert.equal(calls,1);assert.equal((await valid.json()).mode,'connected');
  console.log('PASS HTTP handler: invalid inputs, body limit, provider boundary and success contract');
})().catch(error => {console.error(error);process.exitCode=1;});
