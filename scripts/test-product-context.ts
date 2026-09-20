import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildPreventContext, buildDirectScenario, type CapturedForecast} from '../src/lib/product-context';
import type {Snapshot, Weather} from '../src/lib/receptivity/types';
import {validateScenarioForRun, weatherAt} from '../src/lib/sage/scenario-context';
import {readScenario, saveScenario} from '../src/lib/scenario-store';
import type {RunRequest} from '../src/lib/sage/types';
async function main(){
const now=Date.parse('2026-09-19T12:00:00Z'),time=new Date(now).toISOString();
const weather:Weather={time,temperature:30,relativeHumidity:20,windSpeed:32,windDirection:270,precipitation:0,stepHours:.5,source:'Fixture station'};
const cell={id:'cell-test',name:'Fixture forest',center:[2.1,41.4] as [number,number],ring:[[2.099,41.399],[2.101,41.399],[2.101,41.401],[2.099,41.401],[2.099,41.399]],fuel:{type:'Tree cover',burnableFraction:.9,continuity:.9,fractions:{forest:.9},source:'Fixture cover',epoch:'2021',ndvi:.6,ndmi:-.1,satelliteAt:time,satelliteCoverage:.8},terrain:{slope:25,elevation:200,aspect:180},stationId:'fixture',stationDistanceKm:3,confidence:.7,confidenceLabel:'moderate',receptivity:[85],spread:[45],velocity:null,localExposure:{status:'ready' as const,sourceDate:time,rangeM:1100,nearestM:50,counts:{school:1,healthcare:0,complex:0,road:2,gathering:0}}};
const snapshot:Snapshot={version:'fixture',generatedAt:time,nextRefreshAt:time,observationRange:{oldest:time,newest:time},region:'Fixture only',areaKm2:1,cellSizeM:200,bbox:[2,41,3,42],horizons:[0],cells:[cell],stations:[{station:{id:'fixture',name:'Fixture station',center:[2.11,41.4],elevation:200},frames:[{horizon:0,timestamp:time,fireReceptivity:85,spreadPotential:45,ffmc:94,fineFuelMoisture:8,isi:20,classification:'dry',conditions:weather,velocity:null}],history:{continuousHours:72},forecastSource:'Fixture forecast',forecastIssuedAt:time,quality:[]}],satellite:{status:'live',source:'Fixture thermal',retrievedAt:time,detail:'Fixture',observations:[]},sources:[{id:'xema',name:'Fixture station',status:'live',retrievedAt:time,validAt:time,url:'https://example.test',detail:'Fixture'}],official:{status:{id:'official',name:'Fixture',status:'unavailable',url:'',detail:''},features:{type:'FeatureCollection',features:[]},comparable:false},counts:{vegetated:1,assessed:1,high:1,veryHigh:0,extreme:0},warnings:[]};
const forecast:CapturedForecast={weather:Array.from({length:5},(_,i)=>({...weather,time:new Date(now+i*3600000).toISOString(),stepHours:1,source:'Fixture forecast',windSpeed:40+i})),source:'Fixture forecast',issuedAt:time,detail:'Test hourly forcing',retrievedAt:time};
const context=buildPreventContext(snapshot,'cell-test',0,now,forecast);
assert.equal(context.basis,'hypothetical');assert.equal(context.incident,null);assert.equal(context.ignitionAt,time);assert.equal(context.inputs.deadMoisturePct,8);assert.equal(context.inputs.liveMoisturePct,null);assert.equal(context.inputs.weather[0].directNormalWm2,null);assert.equal(context.assessment?.conclusion,'Review conditions');
assert.equal(weatherAt(context.inputs.weather,now+30*60000)?.windKmh,40,'Original hourly forecast fills actual supported interval after station sample expires');
const request:RunRequest={lat:41.4,lon:2.1,horizonMinutes:120,ignitionRadiusM:50,deadMoisturePct:8,liveMoisturePct:90,windAdjustment:.35,mode:'scenario',confirmation:'',solarDrying:false};
validateScenarioForRun(context,request);
assert.throws(()=>validateScenarioForRun(context,{...request,solarDrying:true}),/radiation/);
assert.throws(()=>validateScenarioForRun(context,{...request,mode:'confirmed'}),/hypothetical/);
const changed=structuredClone(snapshot);changed.stations[0].frames[0].conditions.windSpeed=52;changed.stations[0].frames[0].fineFuelMoisture=5;
const changedContext=buildPreventContext(changed,'cell-test',0,now,forecast);assert.equal(changedContext.inputs.weather[0].windKmh,52);assert.equal(changedContext.inputs.deadMoisturePct,5);assert.equal(context.inputs.weather[0].windKmh,32,'Earlier context remains immutable');
const changedSource=buildPreventContext(snapshot,'cell-test',0,now,{...forecast,issuedAt:new Date(now+60000).toISOString()});assert.throws(()=>validateScenarioForRun(changedSource,request),/does not cover/,'A newer cache is not silently mixed into an older assessment');
const noDirection=structuredClone(snapshot);delete noDirection.stations[0].frames[0].conditions.windDirection;assert.equal(buildPreventContext(noDirection,'cell-test',0,now).inputs.weather.length,0,'Missing direction is not zero-filled');
assert(buildPreventContext(snapshot,'cell-test',0,now+3*3600000).limitations.some(v=>v.startsWith('Historical weather')));
assert.throws(()=>buildPreventContext(snapshot,'missing',0,now));assert.throws(()=>buildDirectScenario({lat:0,lon:0},now));
assert(context.evidence.find(e=>e.id==='soil-moisture')?.consumers.includes('Inspection only'));
const dir=await mkdtemp(join(tmpdir(),'ginger-scenarios-test-'));process.env.GINGER_SCENARIO_DIR=dir;
try {const saved=await saveScenario(context);assert(saved.id);assert.deepEqual(await readScenario(saved.id),saved);context.name='Mutated caller';assert.notEqual((await readScenario(saved.id))?.name,context.name);assert.equal(await readScenario('../../secret'),null);const path=join(dir,`${saved.id}.json`),raw=JSON.parse(await readFile(path,'utf8'));raw.scenario.inputs.deadMoisturePct=99;await writeFile(path,JSON.stringify(raw));await assert.rejects(()=>readScenario(saved.id),/integrity/);}finally{await rm(dir,{recursive:true,force:true});}
console.log('PASS: Prevent evidence → immutable scenario → Sage weather coverage; changed wind/moisture propagate; source-version mismatch, stale evidence, missing direction, solar block and storage integrity verified.');

}
main().catch(error=>{console.error(error);process.exitCode=1;});
