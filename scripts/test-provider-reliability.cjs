const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict');
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const {cached,fetchJSON,clearProviderCacheForTests}=require('../src/lib/providers/http.ts');
const {OSMProvider,OpenMeteoWeatherProvider,parseSatelliteObservations}=require('../src/lib/providers/adapters.ts');
const originalFetch=global.fetch;let checks=0;
async function test(name,fn){clearProviderCacheForTests();await fn();checks++;console.log('PASS',name);}
(async()=>{
 await test('cache deduplicates simultaneous requests',async()=>{let n=0;const load=async()=>{n++;await new Promise(r=>setTimeout(r,5));return 7};assert.deepEqual(await Promise.all([cached('x',100,load),cached('x',100,load)]),[7,7]);assert.equal(n,1)});
 await test('sync loader failures release inflight key',async()=>{await assert.rejects(cached('x',100,()=>{throw Error('bad')}));assert.equal(await cached('x',100,async()=>8),8)});
 await test('cache reset cannot be repopulated by old inflight requests',async()=>{let finish;const pending=cached('x',100,()=>new Promise(r=>finish=r));await Promise.resolve();clearProviderCacheForTests();finish(3);await pending;assert.equal(await cached('x',100,async()=>4),4)});
 await test('LRU memory is bounded at 256 entries',async()=>{for(let i=0;i<257;i++)await cached(String(i),10000,async()=>i);assert.equal(await cached('0',10000,async()=>999),999)});
 await test('transient GET status retries once',async()=>{let calls=0;global.fetch=async()=>++calls===1?new Response('',{status:503,headers:{'retry-after':'0'}}):Response.json({ok:true});assert.deepEqual(await fetchJSON('https://test.invalid'),{ok:true});assert.equal(calls,2)});
 await test('permanent 401 does not retry',async()=>{let calls=0;global.fetch=async()=>{calls++;return new Response('',{status:401})};await assert.rejects(fetchJSON('https://test.invalid'),/401/);assert.equal(calls,1)});
 await test('POST is not blindly replayed',async()=>{let calls=0;global.fetch=async()=>{calls++;return new Response('',{status:503})};await assert.rejects(fetchJSON('https://test.invalid',{method:'POST'}));assert.equal(calls,1)});
 await test('long Retry-After is not violated',async()=>{let calls=0;global.fetch=async()=>{calls++;return new Response('',{status:429,headers:{'retry-after':'60'}})};await assert.rejects(fetchJSON('https://test.invalid'),/429/);assert.equal(calls,1)});
 await test('invalid JSON is not retried',async()=>{let calls=0;global.fetch=async()=>{calls++;return new Response('bad')};await assert.rejects(fetchJSON('https://test.invalid'),/invalid JSON/);assert.equal(calls,1)});
 await test('caller cancellation honored before network',async()=>{let calls=0;global.fetch=async()=>{calls++;return Response.json({})};const c=new AbortController();c.abort();await assert.rejects(fetchJSON('https://test.invalid',{signal:c.signal}));assert.equal(calls,0)});
 await test('Overpass partial payload is rejected',async()=>{global.fetch=async()=>Response.json({elements:[],remark:'runtime timeout'});await assert.rejects(new OSMProvider().assets(),/Incomplete/)});
 await test('weather wrong units rejected',async()=>{global.fetch=async()=>Response.json({current:{time:new Date().toISOString(),temperature_2m:30,relative_humidity_2m:20,wind_speed_10m:25,wind_direction_10m:180},current_units:{temperature_2m:'°C',relative_humidity_2m:'%',wind_speed_10m:'mph',wind_direction_10m:'°'}});await assert.rejects(new OpenMeteoWeatherProvider().current(41,1),/units/)});
 await test('MTG impossible coordinates and future timestamps rejected',async()=>{const base={id:'a',position:[1,41],frpMw:10,observedAt:new Date().toISOString()};assert.throws(()=>parseSatelliteObservations([{...base,position:[181,41]}]));assert.throws(()=>parseSatelliteObservations([{...base,observedAt:new Date(Date.now()+3600000).toISOString()}]));});
 console.log(`${checks} provider reliability checks passed`);
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{global.fetch=originalFetch;clearProviderCacheForTests()});
