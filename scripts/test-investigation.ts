import assert from 'node:assert/strict';
import {attributeChanges} from '../src/lib/sage/attribution';
import {simulateLandscape} from '../src/lib/sage/engine';
import {cellPolygon,toLonLat} from '../src/lib/sage/geometry';
import {compareRuns,compoundExposure,perimeterFit,sensitivity,validateDependencies,validateExperiment,validatePolygon} from '../src/lib/sage/investigation';
import {thermalTracks} from '../src/lib/sage/thermal';
import {validateRunRequest} from '../src/lib/sage/validation';
import type {Landscape,RunRequest} from '../src/lib/sage/types';
import type {Hotspot} from '../src/lib/providers/types';
const center:[number,number]=[1.83,41.73],origin='2026-09-19T10:00:00.000Z';
const request:RunRequest={lat:center[1],lon:center[0],horizonMinutes:60,ignitionRadiusM:25,deadMoisturePct:7,liveMoisturePct:90,windAdjustment:.35,mode:'scenario',confirmation:'',solarDrying:false};
const land:Landscape={center,size:20,cellM:25,elevations:Array(400).fill(100),buildings:{type:'FeatureCollection',features:[{type:'Feature',geometry:cellPolygon(100,0,10,center),properties:{id:'b1',name:'Test building',heightM:10,source:'fixture'}}]},landcover:{type:'FeatureCollection',features:[{type:'Feature',geometry:cellPolygon(0,0,250,center),properties:{categoria:'Prats'}}]},weather:Array.from({length:6},(_,i)=>({time:new Date(Date.parse(origin)+i*3600000).toISOString(),temperatureC:30,humidityPct:20,windKmh:30,windFromDegrees:270,directNormalWm2:600,diffuseWm2:100,precipitationMm:0})),sources:[],warnings:[]};
const experiment={parentId:'12345678-1234-4123-8123-123456789012',windOffset:0,windFactor:1,windShiftMinutes:0,ignitionOffset:[0,0] as [number,number]};
let count=0;function test(name:string,fn:()=>void){fn();count++;console.log('PASS',name);}
const baseline=simulateLandscape(land,request,'base',()=>{},origin);
test('unchanged branch reproduces the original spread',()=>{const branch=simulateLandscape(land,{...request,experiment},'branch',()=>{},origin);assert.deepEqual(branch.cells,baseline.cells);assert.equal(compareRuns(baseline,branch,60).addedHa,0);});
test('counterfactual wind changes the front without mutating baseline data',()=>{const snapshot=JSON.stringify(land);const branch=simulateLandscape(land,{...request,experiment:{...experiment,windOffset:180}},'wind',()=>{},origin);const diff=compareRuns(baseline,branch,60);assert.ok(diff.addedHa>0);assert.ok(diff.removedHa>0);assert.equal(JSON.stringify(land),snapshot);assert.ok(diff.changed.some(v=>v.startsWith('Wind:')));});
test('attribution isolates wind and moisture effects against one baseline',()=>{const next={...request,deadMoisturePct:3,experiment:{...experiment,windOffset:180}};const effects=attributeChanges(land,baseline,next);assert.deepEqual(effects.map(e=>e.name).sort(),['Moisture','Wind']);const dry=simulateLandscape(land,{...request,deadMoisturePct:3},'isolated',()=>{},origin);assert.equal(effects.find(e=>e.name==='Moisture')!.areaDeltaHa,dry.stats.burnedHa-baseline.stats.burnedHa);});
test('delayed wind shift leaves earlier spread unchanged',()=>{const branch=simulateLandscape(land,{...request,experiment:{...experiment,windOffset:180,windShiftMinutes:30}},'delayed',()=>{},origin);assert.equal(compareRuns(baseline,branch,20).addedHa,0);assert.equal(compareRuns(baseline,branch,20).removedHa,0);});
test('moisture and ignition offsets alter the numerical run',()=>{const dry=simulateLandscape(land,{...request,deadMoisturePct:3,experiment},'dry',()=>{},origin);assert.notDeepEqual(dry.cells,baseline.cells);const moved=simulateLandscape(land,{...request,experiment:{...experiment,ignitionOffset:[-150,0]}},'move',()=>{},origin);assert.notDeepEqual(moved.cells,baseline.cells);});
test('fuel removal blocks cells, imported extent seeds corrected simulation',()=>{const polygon=cellPolygon(75,0,30,center);const branch=simulateLandscape(land,{...request,experiment:{...experiment,fuelBreak:polygon}},'break',()=>{},origin);assert.notDeepEqual(branch.cells,baseline.cells);const corrected=simulateLandscape(land,{...request,experiment:{...experiment,observation:{geometry:cellPolygon(100,100,40,center),observedAt:origin,source:'test survey'}}},'correct',()=>{},origin);assert.notDeepEqual(corrected.cells,baseline.cells);});
test('perimeter fit measures misses and rejects out-of-window observations',()=>{const fit=perimeterFit(baseline,cellPolygon(0,0,50,center),origin);assert.ok(fit.missedHa>0);assert.ok(fit.overlap>=0&&fit.overlap<=1);assert.throws(()=>perimeterFit(baseline,cellPolygon(0,0,50,center),'2026-09-19T09:00Z'));});
test('different domains and observations outside the grid are rejected',()=>{assert.throws(()=>compareRuns(baseline,{...baseline,center:[2,42]},60));assert.throws(()=>simulateLandscape(land,{...request,experiment:{...experiment,fuelBreak:cellPolygon(1000,0,30,center)}},'bad',()=>{},origin));});
test('sensitivity ranks isolated inputs and produces geographically distinct targets',()=>{const s=sensitivity(baseline);assert.equal(s.members.length,6);assert.ok(s.members.every(m=>!m.name.includes(' / ')));assert.ok(s.overlay.features.length>0);assert.ok(s.targets.length<=3);});
test('compound exposure requires multiple dependency kinds in the same group',()=>{const props={source:'fixture',verifiedAt:origin,group:'Town',name:'Test'};const assets=validateDependencies({type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Point',coordinates:toLonLat([12,12],center)},properties:{...props,kind:'power'}},{type:'Feature',geometry:{type:'LineString',coordinates:[toLonLat([-10,0],center),toLonLat([100,0],center)]},properties:{...props,kind:'access'}},{type:'Feature',geometry:{type:'Point',coordinates:toLonLat([1000,1000],center)},properties:{...props,group:'Other',kind:'water'}}]});const e=compoundExposure(baseline,assets,60);assert.equal(e.groups[0].exposedKinds.length,2);assert.equal(e.groups[1].assets[0].partial,true);assert.equal(e.groups[1].assets[0].exposed,false);});
test('malformed, oversized and unsourced imports are rejected',()=>{assert.throws(()=>validatePolygon({type:'Polygon',coordinates:[[[0,0],[1,1],[2,2],[0,0]]]}));assert.throws(()=>validateDependencies({type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Point',coordinates:center},properties:{}}]}));assert.throws(()=>validateExperiment({...experiment,parentId:'../../secret'}));assert.throws(()=>validateExperiment({...experiment,windShiftMinutes:15}));assert.deepEqual(validateRunRequest({...request,experiment}).experiment,experiment);});
const hotspot=(id:string,time:string,mw:number):Hotspot=>({id,position:center,frpMw:mw,confidence:'nominal',clusterId:null,provenance:{source:'fixture',observedAt:time,retrievedAt:origin,mode:'live'}});
test('thermal history deduplicates fetches and distinguishes passes from pixels',()=>{const h=hotspot('a','2026-09-19T10:00Z',3);const tracks=thermalTracks([h,h,{...h,id:'b'}],center,null,Date.parse(origin));assert.equal(tracks[0].passes,1);assert.equal(tracks[0].peakMw,3);assert.equal(tracks[0].trendMw,null);});
test('recurrence is not industrial classification and stale events do not escalate',()=>{const hs=[hotspot('a','2026-09-17T10:00Z',3),hotspot('b','2026-09-18T10:00Z',5),hotspot('c','2026-09-19T10:00Z',8)];const [t]=thermalTracks(hs,center,{windKmh:30,humidityPct:20},Date.parse(origin));assert.equal(t.days,3);assert.equal(t.priority,'review');assert.ok(t.reasons.includes('Recurring location · cause unverified'));assert.equal(thermalTracks(hs,center,{windKmh:30,humidityPct:20},Date.parse(origin)+86400000)[0].priority,'watch');});
console.log(`${count} investigation checks passed`);
async function storageChecks(){
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');
 const {recordThermalHistory}=await import('../src/lib/sage/thermal-store');
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'ginger-thermal-test-')),file=path.join(folder,'history.json');
 try{
  const first=hotspot('one',new Date().toISOString(),3),second=hotspot('two',new Date().toISOString(),5);
  await Promise.all([recordThermalHistory([first],file),recordThermalHistory([second,first],file)]);
  const retained=await recordThermalHistory([],file);assert.equal(retained.length,2);
  assert.equal((await recordThermalHistory([{...first,id:'demo',provenance:{...first.provenance,mode:'demo'}}],file)).length,2);
  console.log('PASS concurrent history writes survive reload and exclude demo evidence');
  await fs.writeFile(file,'broken history');await assert.rejects(recordThermalHistory([],file));assert.equal(await fs.readFile(file,'utf8'),'broken history');
  console.log('PASS corrupt history is reported without resetting evidence');
 }finally{await fs.rm(folder,{recursive:true});}
}
storageChecks().catch(error=>{console.error(error);process.exitCode=1;});
