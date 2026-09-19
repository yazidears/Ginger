import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {simulateLandscape} from '../src/lib/sage/engine';
import {cellCenter,cellPolygon,indexAt,toLocal} from '../src/lib/sage/geometry';
import {createBehaviorModel,directionalRate} from '../src/lib/sage/physics';
import type {Landscape,RunRequest,XY} from '../src/lib/sage/types';

const origin='2026-09-19T12:00:00.000Z',center:XY=[1.83,41.73];
const request:RunRequest={lat:center[1],lon:center[0],horizonMinutes:240,ignitionRadiusM:.01,deadMoisturePct:7,liveMoisturePct:90,windAdjustment:.35,mode:'scenario',confirmation:'',solarDrying:false};

async function main(){
  await mkdir('reports/ginger-o1',{recursive:true});
  await writeFile('reports/ginger-o1/grid-benchmark.json',JSON.stringify({status:'running'})+'\n');
  const cases=[];
  // Uniform, flat point-source ellipses have an independent analytical arrival
  // solution: distance / directional rate. No synthetic "observations" are used.
  for(const fuel of [{code:'1',cover:'Prats'},{code:'6',cover:'Matollar'},{code:'9',cover:'Bosc'}])for(const cellM of [12.5,25])for(const windKmh of [0,15,30])for(const windFromDegrees of [0,22.5,45,67.5]){
    const size=21,half=size*cellM/2;
    const land:Landscape={center,size,cellM,elevations:Array(size*size).fill(100),buildings:{type:'FeatureCollection',features:[]},landcover:{type:'FeatureCollection',features:[{type:'Feature',geometry:cellPolygon(0,0,half,center),properties:{categoria:fuel.cover}}]},weather:Array.from({length:6},(_,h)=>({time:new Date(Date.parse(origin)+h*3600000).toISOString(),temperatureC:30,humidityPct:20,windKmh,windFromDegrees,directNormalWm2:0,diffuseWm2:0,precipitationMm:0})),sources:[],warnings:[]};
    const behavior=createBehaviorModel()(fuel.code,7,90,windKmh*.35,windFromDegrees,[0,0]);
    const runs=(['legacy8','ginger16'] as const).map(stencil=>simulateLandscape(land,request,'numerical-benchmark',()=>{},origin,{stencil}));
    const fields=runs.map(run=>new Map(run.cells.features.map(f=>[indexAt(toLocal(f.geometry.coordinates[0][0],center).map(v=>v+cellM/2) as XY,size,cellM),f.properties!.arrivalCentral as number|null])));
    const errors:number[][]=[[],[]];let exactReach=0;const missed=[0,0];
    for(let i=0;i<size*size;i++){
      const p=cellCenter(i,size,cellM),distance=Math.hypot(...p);
      if(distance<cellM*3||distance>half-cellM)continue;
      const exact=distance/directionalRate(behavior,(Math.atan2(p[0],p[1])*180/Math.PI+360)%360);
      if(exact>request.horizonMinutes)continue;exactReach++;
      for(let mode=0;mode<2;mode++){
        const value=fields[mode].get(i);
        if(value===null||value===undefined){missed[mode]++;continue;}
        // Only compare timing errors on shared reached cells, with misses separate.
        if(fields.every(field=>typeof field.get(i)==='number'))errors[mode].push(Math.abs(value-exact)/exact);
      }
    }
    if(exactReach>0)assert.ok(errors[0].length>0,'Analytical reach exists but neither solver reaches any comparison cell');
    const row={fuel:fuel.code,cellM,windKmh,windFromDegrees,exactReach,comparedCells:errors[0].length,status:exactReach?'scored':'no analytical reach beyond three cells within horizon',legacy:{meanRelativeError:errors[0].length?errors[0].reduce((a,b)=>a+b,0)/errors[0].length:null,missed:missed[0]},ginger:{meanRelativeError:errors[1].length?errors[1].reduce((a,b)=>a+b,0)/errors[1].length:null,missed:missed[1]}};
    cases.push(row);console.log(`Fuel ${fuel.code} grid ${cellM}m wind ${windKmh}/${windFromDegrees}: ${row.status==='scored'?`${(row.legacy.meanRelativeError!*100).toFixed(2)}% → ${(row.ginger.meanRelativeError!*100).toFixed(2)}%`:row.status}`);
  }
  const scored=cases.filter(c=>c.status==='scored');
  const legacy=scored.reduce((s,c)=>s+c.legacy.meanRelativeError!,0)/scored.length,ginger=scored.reduce((s,c)=>s+c.ginger.meanRelativeError!,0)/scored.length;
  const report={status:'passed',generatedAt:new Date().toISOString(),kind:'synthetic analytical numerical verification, not historical validation',cases:cases.length,scoredCases:scored.length,unscoredCases:cases.length-scored.length,fullEnsembleRuns:cases.length*2,memberRuns:cases.length*2*9,meanCaseRelativeTimingError:{legacy8:legacy,ginger16:ginger},relativeReduction:1-ginger/legacy,details:cases};
  assert.ok(ginger<legacy*.8,'Require at least 20% lower mean numerical timing error');
  assert.ok(cases.every(c=>c.ginger.missed<=c.legacy.missed),'No increased missed reach in analytical cases');
  await writeFile('reports/ginger-o1/grid-benchmark.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({...report,details:undefined},null,2));
}
main().catch(async e=>{await writeFile('reports/ginger-o1/grid-benchmark.json',JSON.stringify({status:'failed',error:String(e)})+'\n');console.error(e);process.exitCode=1;});
