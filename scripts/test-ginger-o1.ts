import assert from 'node:assert/strict';
import {bootstrapImprovement,csvRecords,fitScale,metrics,requiredNumber} from '../src/lib/sage/backtest';
import {edgeIsOpen,travelEdge,travelStencil} from '../src/lib/sage/propagation';
import {validateCases} from './backtest-ginger-o1-perimeters';
import {cellPolygon} from '../src/lib/sage/geometry';
import type {Landscape,RunRequest} from '../src/lib/sage/types';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
let count=0;
function test(name:string,fn:()=>void){fn();console.log('PASS',name);count++;}
test('long edges inspect intermediate fuel and unknown cells',()=>{
  const edge=travelEdge(2,1),fuel=Array(25).fill(1);
  assert.equal(edgeIsOpen(edge,1,1,5,fuel),true);
  for(const guard of edge.guards){const i=(1+guard.dy)*5+1+guard.dx;fuel[i]=0;assert.equal(edgeIsOpen(edge,1,1,5,fuel),false);fuel[i]=-1;assert.equal(edgeIsOpen(edge,1,1,5,fuel),false);fuel[i]=1;}
  assert.equal(edgeIsOpen(edge,4,1,5,fuel),false);
});
test('all sixteen directions preserve path length and reversal symmetry',()=>{
  assert.equal(travelStencil('ginger16').length,16);
  for(const edge of travelStencil('ginger16')){
    assert.ok(Math.abs(edge.segments.reduce((s,p)=>s+p.fraction,0)-1)<1e-12);
    const reverse=travelEdge(-edge.dx,-edge.dy);
    assert.deepEqual(reverse.segments.map(p=>[p.dx+edge.dx,p.dy+edge.dy,p.fraction]).reverse(),edge.segments.map(p=>[p.dx,p.dy,p.fraction]));
  }
});
test('diagonals cannot cut blocked corners',()=>{
  const fuel=Array(9).fill(1);fuel[1]=0;
  assert.equal(edgeIsOpen(travelEdge(1,1),0,0,3,fuel),false);
});
test('CSV preserves missing observations and quoted fields',()=>{
  assert.deepEqual(csvRecords('id,value,note\r\na,NA,"hello, world"\r\n'),[{id:'a',value:'NA',note:'hello, world'}]);
  for(const x of [undefined,'','NA','NaN','null'])assert.equal(requiredNumber(x),null);
  assert.equal(requiredNumber('0'),0);assert.throws(()=>csvRecords('x,x\n1,2'));
});
test('metrics count misses numerically and report signed bias',()=>{
  const m=metrics([{day:'a',observed:10,predicted:0},{day:'b',observed:20,predicted:30}]);
  assert.equal(m.mae,10);assert.equal(m.bias,0);assert.equal(m.rmse,10);assert.equal(m.withinFactorTwo,.5);
  assert.throws(()=>metrics([]));assert.throws(()=>metrics([{day:'a',observed:NaN,predicted:2}]));
});
test('calibration fits training only; day bootstrap is deterministic and paired',()=>{
  const rows=[{day:'a',observed:20,predicted:10},{day:'b',observed:40,predicted:20}];
  assert.equal(fitScale(rows),2);
  const candidate=rows.map(r=>({...r,predicted:r.predicted*2}));
  const a=bootstrapImprovement(rows,candidate,100);
  assert.deepEqual(a,bootstrapImprovement(rows,candidate,100));assert.ok(a!.lower>0);
  assert.throws(()=>bootstrapImprovement(rows,candidate.slice(1)));
  assert.equal(bootstrapImprovement(rows.slice(0,1),candidate.slice(0,1)),null);
});
test('historical cases reject time leakage, current landscapes and split leakage',()=>{
  const geometry=cellPolygon(0,0,25,[1.83,41.73]),origin='2020-08-01T12:00:00Z';
  const request:RunRequest={lat:41.73,lon:1.83,horizonMinutes:60,ignitionRadiusM:25,deadMoisturePct:7,liveMoisturePct:90,windAdjustment:.35,mode:'scenario',confirmation:'',solarDrying:false,experiment:{parentId:'offline',windOffset:0,windFactor:1,windShiftMinutes:0,ignitionOffset:[0,0],observation:{geometry,observedAt:origin,source:'synthetic test only'}}};
  const landscape:Landscape={center:[1.83,41.73],cellM:25,size:4,elevations:Array(16).fill(0),weather:[],buildings:{type:'FeatureCollection',features:[]},landcover:{type:'FeatureCollection',features:[]},sources:[],warnings:[]};
  const c={id:'fixture',eventId:'fixture-event',split:'test' as const,origin,request,landscape,provenance:{weatherKind:'reanalysis' as const,weatherSource:'synthetic test',landscapeSource:'synthetic test',landscapeValidAt:'2020-01-01',initialExtentSource:'synthetic test'},observations:[{at:'2020-08-01T12:30:00Z',source:'synthetic test only',geometry}]};
  validateCases([c]);
  assert.throws(()=>validateCases([c,{...c,id:'another',split:'train'}]),/cross data splits/);
  assert.throws(()=>validateCases([{...c,observations:[{...c.observations[0],at:origin}]}]),/after origin/);
  assert.throws(()=>validateCases([{...c,provenance:{...c.provenance,landscapeValidAt:'2021-01-01'}}]),/pre-event/);
  assert.throws(()=>validateCases([c,c]),/Duplicate/);
});
test('offline perimeter CLI evaluates a synthetic fixture and retains failed cases',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'ginger-o1-test-'));
  try{
    const center:[number,number]=[1.83,41.73],origin='2020-08-01T12:00:00Z';
    const c={id:'synthetic-fixture',eventId:'synthetic-event',split:'test',origin,
      provenance:{weatherKind:'reanalysis',weatherSource:'synthetic fixture',landscapeSource:'synthetic fixture',landscapeValidAt:'2020-01-01',initialExtentSource:'synthetic fixture'},
      observations:[{at:'2020-08-01T12:30:00Z',source:'synthetic fixture',geometry:cellPolygon(0,0,40,center)}],
      request:{lat:center[1],lon:center[0],horizonMinutes:60,ignitionRadiusM:25,deadMoisturePct:7,liveMoisturePct:90,windAdjustment:.35,mode:'scenario',confirmation:'',solarDrying:false,experiment:{parentId:'offline',windOffset:0,windFactor:1,windShiftMinutes:0,ignitionOffset:[0,0],observation:{geometry:cellPolygon(0,0,10,center),observedAt:origin,source:'synthetic fixture'}}},
      landscape:{center,size:8,cellM:25,elevations:Array(64).fill(100),buildings:{type:'FeatureCollection',features:[]},landcover:{type:'FeatureCollection',features:[{type:'Feature',geometry:cellPolygon(0,0,100,center),properties:{categoria:'Prats'}}]},sources:[],warnings:[],weather:Array.from({length:3},(_,h)=>({time:new Date(Date.parse(origin)+h*3600000).toISOString(),temperatureC:30,humidityPct:20,windKmh:15,windFromDegrees:270,directNormalWm2:0,diffuseWm2:0,precipitationMm:0}))}};
    const input=path.join(dir,'cases.json'),output=path.join(dir,'report.json');
    writeFileSync(input,JSON.stringify([c,{...c,id:'synthetic-bad-terrain',landscape:{...c.landscape,elevations:[]}}]));
    const run=spawnSync(process.execPath,['--import','tsx','scripts/backtest-ginger-o1-perimeters.ts',input,output],{encoding:'utf8',timeout:30000});
    assert.equal(run.status,1,run.stderr);
    const report=JSON.parse(readFileSync(output,'utf8'));
    assert.deepEqual(report.counts,{cases:2,events:1,evaluated:1,failed:1});
    assert.ok(report.evaluations[0].fits[0].overlap>=0&&report.evaluations[0].fits[0].overlap<=1);
    assert.match(report.evaluations[1].error,/terrain/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
console.log(`${count} GingerO1 checks passed`);
