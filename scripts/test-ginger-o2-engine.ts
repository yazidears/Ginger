import assert from 'node:assert/strict';
import {simulateLandscape} from '../src/lib/sage/engine';
import {cellCenter,cellPolygon} from '../src/lib/sage/geometry';
import {validateRunRequest} from '../src/lib/sage/validation';
import {compareRuns} from '../src/lib/sage/investigation';
import type {Landscape,RunRequest,XY} from '../src/lib/sage/types';
const origin='2026-09-19T12:00:00Z',center:XY=[1.83,41.73];
const request:RunRequest={lat:center[1],lon:center[0],horizonMinutes:60,ignitionRadiusM:25,deadMoisturePct:7,liveMoisturePct:90,windAdjustment:.35,mode:'scenario',confirmation:'',solarDrying:false};
function fixture():Landscape{return {center,size:16,cellM:25,elevations:Array(256).fill(100),buildings:{type:'FeatureCollection',features:[{type:'Feature',geometry:cellPolygon(100,0,10,center),properties:{id:'fixture-building',name:'Synthetic test building',heightM:8}}]},landcover:{type:'FeatureCollection',features:[{type:'Feature',geometry:cellPolygon(0,0,200,center),properties:{categoria:'Prats i herbassars'}}]},weather:Array.from({length:3},(_,h)=>({time:new Date(Date.parse(origin)+h*3600000).toISOString(),temperatureC:30,humidityPct:20,windKmh:30,windFromDegrees:270,directNormalWm2:600,diffuseWm2:100,precipitationMm:0})),sources:[],warnings:[]};}
let tests=0;function test(name:string,fn:()=>void){fn();console.log('PASS',name);tests++;}
const base=simulateLandscape(fixture(),request,'base',()=>{},origin);
const trained=simulateLandscape(fixture(),{...request,grassModel:'ginger-o2'},'trained',()=>{},origin);
test('learned component is explicitly enabled, versioned and changes eligible arrivals',()=>{
  assert.equal(base.model?.name,'GingerO2');assert.equal(base.model?.grassModel,'rothermel');assert.equal(base.model?.learnedGrassCells,0);
  assert.ok(trained.model!.learnedGrassCells!>0);assert.equal(trained.model?.grassArtifactId,'GingerO2-grass-1');
  assert.notDeepEqual(trained.cells,base.cells);
  assert.ok(compareRuns(base,trained,60).changed.includes('Grass spread model changed'));
});
test('a learned head speed does not masquerade as calibrated radiant heat',()=>{
  assert.ok(base.buildings[0].radiantKwM2!==null);
  assert.equal(trained.buildings[0].radiantKwM2,null);assert.equal(trained.buildings[0].radiantAtMinute,null);
  assert.match(trained.assumptions.join(' '),/Radiant heat screening withheld/);
});
test('grass selection is deterministic and omitted selection preserves physical default',()=>{
  assert.deepEqual(simulateLandscape(fixture(),{...request,grassModel:'rothermel'},'explicit',()=>{},origin).cells,base.cells);
  assert.deepEqual(simulateLandscape(fixture(),{...request,grassModel:'ginger-o2'},'again',()=>{},origin).cells,trained.cells);
});
test('crops, slope, forecast rain and unsupported inputs use physical fallback',()=>{
  for(const change of ['crops','slope','rain','wet','calm']){
    const land=fixture();let r={...request,grassModel:'ginger-o2' as const};
    if(change==='crops')land.landcover.features[0].properties={categoria:'Conreu'};
    if(change==='slope')land.elevations=land.elevations.map((_,i)=>100+.03*cellCenter(i,land.size,land.cellM)[0]);
    if(change==='rain')land.weather=land.weather.map(w=>({...w,precipitationMm:1}));
    if(change==='wet')r={...r,deadMoisturePct:20};
    if(change==='calm')land.weather=land.weather.map(w=>({...w,windKmh:0}));
    const result=simulateLandscape(land,r,change,()=>{},origin);
    const physical=simulateLandscape(land,{...r,grassModel:'rothermel'},change,()=>{},origin);
    assert.equal(result.model?.learnedGrassCells,0,change);assert.deepEqual(result.cells,physical.cells,change);
  }
});
test('request validation rejects invented model names and preserves saved-request compatibility',()=>{
  assert.deepEqual(validateRunRequest(request),request);
  assert.equal(validateRunRequest({...request,grassModel:'ginger-o2'}).grassModel,'ginger-o2');
  assert.throws(()=>validateRunRequest({...request,grassModel:'perfect-model'}));
  assert.throws(()=>simulateLandscape(fixture(),{...request,grassModel:'unknown'} as unknown as RunRequest,'invalid',()=>{},origin));
});
console.log(`${tests} GingerO2 engine integration checks passed`);
