/** Offline historical perimeter evaluation. Never fetches today's weather/cover. */
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {simulateLandscape} from '../src/lib/sage/engine';
import {perimeterFit,validatePolygon} from '../src/lib/sage/investigation';
import type {Landscape,RunRequest} from '../src/lib/sage/types';
import type {Polygon} from 'geojson';

type Case={id:string;eventId:string;split:'train'|'validation'|'test';origin:string;
  request:RunRequest;landscape:Landscape;
  provenance:{weatherKind:'archived-forecast'|'observation'|'reanalysis';weatherSource:string;landscapeSource:string;landscapeValidAt:string;initialExtentSource:string};
  observations:{at:string;source:string;geometry:Polygon}[]};

export function validateCase(c:Case){
  if(!c||typeof c.id!=='string'||!c.id.trim()||typeof c.eventId!=='string'||!c.eventId.trim()||!['train','validation','test'].includes(c.split))throw Error('Case requires ID, event ID and split');
  const origin=Date.parse(c.origin);
  if(!Number.isFinite(origin)||origin>=Date.now()||c.request.structural)throw Error('Use a past origin and surface-only perimeter case');
  const p=c.provenance;
  if(!p||!['archived-forecast','observation','reanalysis'].includes(p.weatherKind)||[p.weatherSource,p.landscapeSource,p.initialExtentSource].some(x=>typeof x!=='string'||x.trim().length<3)||!Number.isFinite(Date.parse(p.landscapeValidAt))||Date.parse(p.landscapeValidAt)>origin)throw Error('Historical weather, pre-event landscape and initial-extent provenance required');
  const initial=c.request.experiment?.observation;
  if(!initial||Date.parse(initial.observedAt)!==origin||typeof initial.source!=='string'||initial.source.trim().length<3)throw Error('A sourced initial perimeter at the forecast origin is required');
  validatePolygon(initial.geometry);
  if(c.request.lat!==c.landscape.center[1]||c.request.lon!==c.landscape.center[0])throw Error('Request and snapshot domains differ');
  if(!Array.isArray(c.observations)||!c.observations.length)throw Error('Independent later perimeters required');
  const seen=new Set<string>();
  for(const o of c.observations){
    const time=Date.parse(o.at);
    if(!Number.isFinite(time)||time<=origin||time>origin+c.request.horizonMinutes*60000||typeof o.source!=='string'||o.source.trim().length<3||seen.has(new Date(time).toISOString()))throw Error('Unique sourced observations must be after origin and within horizon');
    seen.add(new Date(time).toISOString());validatePolygon(o.geometry);
  }
}

export function validateCases(cases:Case[]){
  if(!Array.isArray(cases)||!cases.length||cases.length>500)throw Error('Supply 1–500 historical cases');
  const splits=new Map<string,string>(),ids=new Set<string>();
  for(const c of cases){
    validateCase(c);
    if(ids.has(c.id))throw Error('Duplicate case ID');ids.add(c.id);
    if(splits.has(c.eventId)&&splits.get(c.eventId)!==c.split)throw Error('An event cannot cross data splits');
    splits.set(c.eventId,c.split);
  }
}

async function main(){
  const filename=process.argv[2],output=process.argv[3];
  if(!filename||!output)throw Error('Usage: tsx scripts/backtest-ginger-o1-perimeters.ts cases.json report.json');
  const raw=await readFile(filename,'utf8'),cases=JSON.parse(raw) as Case[];validateCases(cases);
  const evaluations=[];
  for(const c of cases){
    try{
      const run=simulateLandscape(c.landscape,c.request,c.id,()=>{},c.origin);
      const fits=c.observations.map(o=>({...perimeterFit(run,o.geometry,o.at),at:o.at,source:o.source}));
      evaluations.push({id:c.id,eventId:c.eventId,split:c.split,status:'evaluated',weatherKind:c.provenance.weatherKind,engine:run.engine,meanOverlap:fits.reduce((s,f)=>s+f.overlap,0)/fits.length,fits,warnings:run.warnings,boundaryReached:run.stats.boundaryReached,fuelCoveragePct:run.stats.fuelCoveragePct});
    }catch(e){evaluations.push({id:c.id,eventId:c.eventId,split:c.split,status:'failed',error:e instanceof Error?e.message:String(e)});}
  }
  const report={generatedAt:new Date().toISOString(),inputSha256:createHash('sha256').update(raw).digest('hex'),
    kind:'historical perimeter hindcast; observations/reanalysis are not operational forecast validation',
    notes:['No tuning is performed by this evaluator. Freeze any candidate before opening test outputs.','Reported scores use cell-centre rasterization; observational resolution and timestamp uncertainty must be considered.','Failed cases remain visible; no silent exclusion or success-only aggregate.','No calibrated probabilities or building-ignition claims are produced.'],
    counts:{cases:cases.length,events:new Set(cases.map(c=>c.eventId)).size,evaluated:evaluations.filter(e=>e.status==='evaluated').length,failed:evaluations.filter(e=>e.status==='failed').length},evaluations};
  await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(report.counts);
  if(report.counts.failed)process.exitCode=1;
}
if(process.argv[1]?.endsWith('backtest-ginger-o1-perimeters.ts'))main().catch(e=>{console.error(e);process.exitCode=1;});
