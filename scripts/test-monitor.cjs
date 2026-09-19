// Run server-module tests with Node's real react-server export condition.
if (!process.execArgv.includes('--conditions=react-server') && !(process.env.NODE_OPTIONS || '').includes('--conditions=react-server')) {
  const result = require('node:child_process').spawnSync(process.execPath, ['--conditions=react-server', __filename, ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict');
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const Module=require('node:module'),originalLoad=Module._load;
Module._load=function(request,parent,...rest){if(parent?.filename.endsWith('/src/lib/monitor.ts')){if(request==='./assessment')return {readLocationWeather:async()=>null};if(request==='./watch-areas')return {watchAreaStore:{list:async()=>[]}};}return originalLoad.call(this,request,parent,...rest);};
const {evaluateZone}=require('../src/lib/monitor.ts');
const now=Date.parse('2026-09-19T12:15:00Z'),iso=new Date(now).toISOString(),zone={id:'test',name:'Test',position:[1.86,41.3]};
const hour={time:'2026-09-19T12:00Z',temperatureC:22,humidityPct:55,windKmh:10,windFromDegrees:180,precipitationMm:0};
const weather=(adverse=false)=>({retrievedAt:iso,data:{current:{...hour},outlook:[{...hour,...adverse?{temperatureC:28,humidityPct:25,windKmh:25}:{}}],past72hPrecipitationMm:0,elevationM:100}});
const fire=(data=[])=>({status:'live',data,updatedAt:iso,detail:'Fixture'});
const hotspot=(time='2026-09-19T12:00Z',position=zone.position)=>({id:'h',position,clusterId:null,frpMw:10,confidence:'nominal',provenance:{source:'test',observedAt:time,retrievedAt:iso,mode:'live'}});
let checks=0;const test=(name,fn)=>{fn();checks++;console.log('PASS',name)};
const assess=(w,f)=>evaluateZone(zone,w,f,now);
test('fresh neutral evidence monitors without all-clear',()=>{const r=assess(weather(),fire());assert.equal(r.state,'monitoring');assert.match(r.reasons[0],/not an all-clear/);});
test('both absent sources unavailable with unknown counts',()=>{const r=assess(null,null);assert.equal(r.state,'unavailable');assert.equal(r.hotspots,null);assert.equal(r.temperature,null);});
test('one absent source is review rather than monitoring',()=>{assert.equal(assess(weather(),null).state,'review');assert.equal(assess(null,fire()).state,'review');});
test('adverse weather alone requests review',()=>assert.equal(assess(weather(true),fire()).state,'review'));
test('recent nearby detection alone requests review',()=>assert.equal(assess(weather(),fire([hotspot()])).state,'review'));
test('combined fresh evidence escalates at inclusive thresholds',()=>{const r=assess(weather(true),fire([hotspot()]));assert.equal(r.state,'escalating');assert.match(r.reasons[0],/not confirmed fires/);});
test('old future and distant detections do not escalate',()=>{for(const h of [hotspot('2026-09-19T05:00Z'),hotspot('2026-09-19T13:00Z'),hotspot('2026-09-19T12:00Z',[2.86,41.3])]){const r=assess(weather(true),fire([h]));assert.equal(r.state,'review');assert.equal(r.hotspots,0);}});
test('stale provider cannot escalate',()=>{const f=fire([hotspot()]);f.status='stale';const r=assess(weather(true),f);assert.equal(r.state,'review');assert.equal(r.hotspots,null);});
test('old retrieval timestamp cannot masquerade as live',()=>{const f=fire([hotspot()]);f.updatedAt='2026-09-19T10:00Z';assert.equal(assess(weather(true),f).state,'review');});
test('stale weather current hour removed from metrics and gating',()=>{const w=weather(true);w.data.current.time='2026-09-19T10:00Z';const r=assess(w,fire([hotspot()]));assert.equal(r.state,'review');assert.equal(r.temperature,null);});
test('stale weather retrieval fails readiness',()=>{const w=weather(true);w.retrievedAt='2026-09-19T11:00Z';assert.equal(assess(w,fire([hotspot()])).state,'review');});
test('hazard ETA chooses earliest qualifying forecast hour',()=>{const w=weather(true);w.data.outlook=[{...w.data.outlook[0],time:'2026-09-19T16:00Z'},{...w.data.outlook[0],time:'2026-09-19T14:00Z'}];const r=assess(w,fire());assert.equal(r.hazardWindow.startsAt,'2026-09-19T14:00Z');assert.equal(r.hazardWindow.endsAt,'2026-09-19T15:00:00.000Z');});
test('missing and stale weather do not invent a countdown',()=>{assert.equal(assess(null,fire()).hazardWindow,null);const w=weather(true);w.retrievedAt='2026-09-19T10:00Z';assert.equal(assess(w,fire()).hazardWindow,null);assert.equal(assess(weather(),fire()).hazardWindow,null);});
console.log(`${checks} monitor checks passed`);
const {detectChanges}=require('../src/lib/monitor.ts');
const baseline=assess(weather(),fire());
const compare=patch=>detectChanges(baseline,{...baseline,...patch,updatedAt:'2026-09-19T12:25:00Z'});
test('first scan and unchanged scan do not invent changes',()=>{assert.deepEqual(detectChanges(undefined,baseline),[]);assert.deepEqual(compare({}),[]);});
test('wind speed alerts at inclusive threshold without status changes',()=>{assert.equal(compare({windKmh:15})[0].kind,'wind');assert.equal(compare({windKmh:14.9}).length,0);});
test('direction comparison wraps north and suppresses calm wind',()=>{assert.equal(detectChanges({...baseline,windFromDegrees:359},{...baseline,windFromDegrees:1}).length,0);assert.equal(compare({windFromDegrees:195})[0].title,'Wind direction shifted');assert.equal(detectChanges({...baseline,windKmh:1},{...baseline,windKmh:1,windFromDegrees:210}).length,0);});
test('temperature and humidity thresholds work in both directions',()=>{assert.equal(compare({temperature:25,humidity:45}).filter(c=>c.kind==='weather').length,2);assert.equal(compare({temperature:19,humidity:65}).filter(c=>c.kind==='weather').length,2);});
test('missing readings produce coverage alerts rather than numeric changes',()=>{const changes=compare({temperature:null,humidity:null,windKmh:null,hotspots:null});assert.equal(changes.length,2);assert.ok(changes.every(c=>c.kind==='coverage'));});
test('coverage recovery is explicitly reported',()=>{assert.ok(detectChanges({...baseline,hotspots:null},baseline).some(c=>c.title==='Satellite coverage restored'));});
test('hazard timing changes and detection ageing remain explicit',()=>{assert.equal(compare({hazardWindow:{startsAt:iso,endsAt:'2026-09-19T13:15:00Z'}})[0].kind,'window');assert.match(detectChanges({...baseline,hotspots:3},baseline)[0].text,/ageing/);});
test('stable repeat has no duplicate alert and identity is stable',()=>{const next={...baseline,windKmh:20};assert.deepEqual(detectChanges(baseline,next),detectChanges(baseline,next));assert.deepEqual(detectChanges(next,next),[]);});
console.log(`${checks} total monitor checks passed`);

test('outside Europe never represents absent detections as zero',()=>{const r=evaluateZone({...zone,position:[-120,38]},weather(),fire(),now);assert.equal(r.hotspots,null);assert.equal(r.state,'review');assert.match(r.reasons.join(' '),/outside/);});
test('watch radius controls filtering',()=>{const r=evaluateZone({...zone,radiusM:100},weather(),fire([hotspot('2026-09-19T12:00Z',[1.87,41.3])]),now);assert.equal(r.hotspots,0);assert.equal(r.radiusM,100);});
test('hazard window includes consecutive qualifying hours only',()=>{const w=weather(true);w.data.outlook=[12,13,15].map(hour=>({...w.data.outlook[0],time:`2026-09-19T${hour}:00Z`}));const r=assess(w,fire());assert.equal(r.hazardWindow.endsAt,'2026-09-19T14:00:00.000Z');});
test('equal counts still expose replaced observations',()=>{const a={...baseline,hotspots:1,detectionIds:['old']},b={...baseline,hotspots:1,detectionIds:['new']};assert.equal(detectChanges(a,b)[0].title,'New thermal observations');assert.deepEqual(detectChanges(b,b),[]);});
test('evidence timestamps retain source age separately from scan time',()=>{const r=assess(weather(),fire([hotspot()]));assert.equal(r.evidence.weatherAgeMinutes,0);assert.equal(r.evidence.weatherValidAt,hour.time);assert.equal(r.evidence.newestDetectionAt,hour.time);});
console.log(`${checks} final monitor checks passed`);

test('Deepfire location query supports monitored sites outside Europe',()=>{const p=[151,-33],f={...fire([hotspot('2026-09-19T12:00Z',p)]),covered:true,source:'Deepfire satellite detections',coverage:'15 km'};assert.equal(evaluateZone({...zone,position:p},weather(true),f,now).state,'escalating');});
test('provider switch is a coverage change rather than new fire growth',()=>{const before={...baseline,hotspots:1,detectionIds:['nasa'],evidence:{...baseline.evidence,satelliteSource:'NASA FIRMS'}};const after={...before,hotspots:2,detectionIds:['deep1','deep2'],evidence:{...before.evidence,satelliteSource:'Deepfire'}};const changes=detectChanges(before,after);assert.ok(changes.some(c=>c.title==='Satellite source changed'));assert.ok(!changes.some(c=>c.kind==='detections'));});
