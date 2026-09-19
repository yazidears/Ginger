/** Bounded offline suite. Never fetch current inputs; preserve failures and event grouping. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {runReplay} from '../src/lib/replay/engine';
import {validateReplayCase} from '../src/lib/replay/validation';
import type {ReplayCase} from '../src/lib/replay/types';

async function main(){
  const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: tsx scripts/backtest-replay.ts cases.json report.json');
  const raw=await readFile(input,'utf8'),cases=JSON.parse(raw) as ReplayCase[];
  if(!Array.isArray(cases)||!cases.length||cases.length>100)throw Error('Supply 1–100 replay cases.');
  const ids=new Set<string>(),events=new Map<string,string>();
  for(const c of cases){if(!c||typeof c.id!=='string'||typeof c.eventId!=='string'||ids.has(c.id))throw Error('Unique case IDs and event IDs required.');ids.add(c.id);if(events.has(c.eventId)&&events.get(c.eventId)!==c.split)throw Error('An incident cannot cross train/validation/test splits.');events.set(c.eventId,c.split);}
  const evaluations=cases.map(c=>{try{validateReplayCase(c);const r=runReplay(c);return {id:c.id,eventId:c.eventId,kind:c.kind,split:c.split,weatherKind:c.provenance.weatherKind,status:'evaluated' as const,summary:r.summary,inputSha256:r.inputSha256,warnings:r.warnings};}catch(e){return {id:c.id,eventId:c.eventId,kind:c.kind,split:c.split,weatherKind:c.provenance?.weatherKind,status:'failed' as const,error:e instanceof Error?e.message:String(e)};}});
  const cohorts=[...new Set(evaluations.filter(e=>e.status==='evaluated').map(e=>`${e.kind}/${e.split}/${e.weatherKind}`))].map(key=>{
    const subset=evaluations.filter(e=>e.status==='evaluated'&&`${e.kind}/${e.split}/${e.weatherKind}`===key);
    const incidentIds=[...new Set(subset.map(e=>e.eventId))];
    const mean=(a:number[])=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
    const eventMeans=incidentIds.map(eventId=>{const rows=subset.filter(e=>e.eventId===eventId);return {eventId,deltaIoU:mean(rows.flatMap(e=>e.summary?.updatedMeanIoU!==null&&e.summary?.baselineMeanIoU!==null&&e.summary?[e.summary.updatedMeanIoU-e.summary.baselineMeanIoU]:[]))};});
    return {cohort:key,evaluatedCases:subset.length,events:eventMeans,meanEventIoUChange:mean(eventMeans.flatMap(e=>e.deltaIoU===null?[]:[e.deltaIoU]))};
  });
  const report={version:1,generatedAt:new Date().toISOString(),inputSha256:createHash('sha256').update(raw).digest('hex'),cases:cases.length,failed:evaluations.filter(e=>e.status==='failed').length,
    notes:['No model fitting. All hypotheses and likelihood settings fixed before evaluation.','Events are weighted equally within kind/split/weather cohorts. Synthetic and historical results never share an aggregate.','Failed cases remain in the report; cohort scores describe evaluated cases only.','No confidence interval from a single incident; no operational accuracy claim.'],cohorts,evaluations};
  await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({cases:report.cases,failed:report.failed,cohorts}));if(report.failed)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
