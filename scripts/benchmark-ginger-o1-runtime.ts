import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {simulateLandscape} from '../src/lib/sage/engine';
import {cellPolygon} from '../src/lib/sage/geometry';
import type {Landscape,RunRequest,XY} from '../src/lib/sage/types';

async function main(){
  const center:XY=[1.83,41.73],size=80,cellM=25,origin='2026-09-19T12:00:00Z';
  const landscape:Landscape={center,size,cellM,elevations:Array(size*size).fill(100),buildings:{type:'FeatureCollection',features:[]},landcover:{type:'FeatureCollection',features:[{type:'Feature',geometry:cellPolygon(0,0,1000,center),properties:{categoria:'Prats'}}]},weather:Array.from({length:6},(_,h)=>({time:new Date(Date.parse(origin)+h*3600000).toISOString(),temperatureC:30,humidityPct:20,windKmh:30,windFromDegrees:270,directNormalWm2:600,diffuseWm2:100,precipitationMm:0})),sources:[],warnings:[]};
  const request:RunRequest={lat:center[1],lon:center[0],horizonMinutes:240,ignitionRadiusM:25,deadMoisturePct:7,liveMoisturePct:90,windAdjustment:.35,mode:'scenario',confirmation:'',solarDrying:true};
  const run=simulateLandscape(landscape,request,'runtime-fixture',stage=>console.log(stage),origin);
  const report={kind:'synthetic runtime smoke test; excludes network and buildings, not a worst-case latency guarantee',engine:run.engine,gridCells:size*size,horizonMinutes:240,members:run.members.length,solarDrying:true,runtimeMs:run.runtimeMs,burnedHa:run.stats.burnedHa,workerComputeBudgetMs:170000,withinBudget:run.runtimeMs<170000};
  await mkdir('reports/ginger-o1',{recursive:true});await writeFile('reports/ginger-o1/runtime-benchmark.json',JSON.stringify(report,null,2)+'\n');
  assert.ok(report.withinBudget,'Synthetic 2 km runtime exceeds the current worker timeout');
  console.log(report);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
