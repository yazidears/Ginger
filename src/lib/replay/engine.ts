import {createHash} from 'node:crypto';
import {simulateLandscape} from '../sage/engine';
import {cellCenter,contains,indexAt,localPolygons,toLocal} from '../sage/geometry';
import type {Polygon} from 'geojson';
import type {ReplayCase,ReplayReport,ReplayFrame} from './types';
import {validateReplayCase} from './validation';
import {probabilityAt,scoreForecast,updateWeights} from './metrics';

export function rasterize(geometry:Polygon,c:ReplayCase):number[] {
  const {size,cellM,center}=c.landscape,parts=localPolygons(geometry,center);
  return Array.from({length:size*size},(_,i)=>contains(cellCenter(i,size,cellM),parts)?1:0);
}

/** Each target is scored BEFORE its observation is eligible to change weights.
 * A delayed earlier observation is usable only after its availability timestamp. */
export function evaluateBank(c:ReplayCase,arrivals:number[][]):ReplayFrame[] {
  const {size,cellM}=c.landscape,origin=Date.parse(c.origin),uniform=arrivals.map(()=>1/arrivals.length);
  const masks=c.observations.map(o=>rasterize(o.geometry,c));
  const initial=rasterize(c.request.experiment!.observation!.geometry,c);
  let weights=[...uniform];const used=new Set<number>();
  return c.observations.map((observation,target)=>{
    // Process by availability, not acquisition order, including out-of-order arrivals.
    const eligible=c.observations.map((o,i)=>({o,i})).filter(({o,i})=>i<target&&!used.has(i)&&Date.parse(o.availableAt)<Date.parse(observation.at))
      .sort((a,b)=>Date.parse(a.o.availableAt)-Date.parse(b.o.availableAt)||a.i-b.i);
    for(const {o,i} of eligible){weights=updateWeights(weights,arrivals,masks[i],(Date.parse(o.at)-origin)/60000,size,o.uncertaintyM/cellM);used.add(i);}
    const minute=(Date.parse(observation.at)-origin)/60000,observed=masks[target];
    const baselineProbability=probabilityAt(arrivals,uniform,minute),updatedProbability=probabilityAt(arrivals,weights,minute);
    let intervalError=0,evaluatedCells=0,noPredictedArrival=0,rightCensoredCells=0;
    observed.forEach((v,i)=>{
      if(initial[i])return;
      if(!v){rightCensoredCells++;return;}
      const first=masks.findIndex((m,j)=>j<=target&&m[i]);
      const low=first===0?0:(Date.parse(c.observations[first-1].at)-origin)/60000;
      const high=(Date.parse(c.observations[first].at)-origin)/60000;
      const candidates=arrivals.map((a,m)=>({at:a[i],w:weights[m]})).sort((a,b)=>a.at-b.at);
      let sum=0,median=Infinity;for(const candidate of candidates){sum+=candidate.w;if(sum>=.5){median=candidate.at;break;}}
      if(!Number.isFinite(median)){noPredictedArrival++;return;}
      intervalError+=Math.max(0,low-median,median-high);evaluatedCells++;
    });
    return {minute,at:observation.at,availableAt:observation.availableAt,source:observation.source,uncertaintyM:observation.uncertaintyM,
      assimilated:[...used],weights:[...weights],effectiveMembers:1/weights.reduce((s,w)=>s+w*w,0),
      baseline:scoreForecast(baselineProbability,observed,size,cellM),updated:scoreForecast(updatedProbability,observed,size,cellM),
      observed,baselineProbability,updatedProbability,observationGeometry:observation.geometry,
      arrival:{intervalErrorMinutes:evaluatedCells?intervalError/evaluatedCells:null,evaluatedCells,noPredictedArrival,rightCensoredCells}};
  });
}

export function runReplay(input:unknown,onStage:(message:string)=>void=()=>{}):ReplayReport {
  const started=Date.now(),c=validateReplayCase(input),{size,cellM,center}=c.landscape;
  const inputSha256=createHash('sha256').update(JSON.stringify(c)).digest('hex');
  const arrivals:number[][]=[],members:ReplayReport['members']=[],warnings=new Set<string>();let engine='';
  // Three predeclared directional hypotheses x the existing nine physical members.
  // Neither the hypotheses nor model parameters are fitted to evaluation targets.
  for(const offset of [-30,0,30]) {
    onStage(`Running wind hypothesis ${offset>0?'+':''}${offset}° · ${arrivals.length}/27 members`);
    const request={...c.request,experiment:{...c.request.experiment!,windOffset:offset}};
    const run=simulateLandscape(c.landscape,request,`replay-${offset}`,()=>{},c.origin);
    engine=run.engine;
    const bank=run.members.map(()=>Array(size*size).fill(Infinity) as number[]);
    for(const f of run.cells.features){
      const ring=f.geometry.coordinates[0],point:[number,number]=[(ring[0][0]+ring[2][0])/2,(ring[0][1]+ring[2][1])/2];
      const index=indexAt(toLocal(point,center),size,cellM);if(index<0)continue;
      (f.properties!.arrivalByMember as (number|null)[]).forEach((at,m)=>{if(at!==null)bank[m][index]=at;});
    }
    arrivals.push(...bank);members.push(...run.members.map(m=>({...m,name:`${offset>0?'+':''}${offset}° · ${m.name}`,windOffset:m.windOffset+offset})));
    if(run.stats.boundaryReached)warnings.add('At least one trajectory reaches the domain edge; scores describe only this bounded domain.');
    if(run.stats.fuelCoveragePct<100)warnings.add('Unknown fuel cells stop propagation; incomplete fuel coverage affects scores.');
  }
  onStage('Replaying observation availability and evaluating held-out boundaries');
  const frames=evaluateBank(c,arrivals);
  for(let t=1;t<frames.length;t++)if(frames[t-1].observed.some((v,i)=>v&&!frames[t].observed[i]))warnings.add('Some observed burned-area cells disappear in later perimeters. Arrival intervals assume cumulative burned area and need review.');
  const mean=(values:(number|null)[])=>{const finite=values.filter((v):v is number=>v!==null);return finite.length?finite.reduce((s,v)=>s+v,0)/finite.length:null;};
  return {version:1,id:c.id,name:c.name,eventId:c.eventId,kind:c.kind,split:c.split,generatedAt:new Date().toISOString(),origin:c.origin,
    inputSha256,engine,method:'Frozen 27-member physical bank; sequential tempered evidence weighting v1; equal-weight baseline; threshold 0.5',
    provenance:c.provenance,request:c.request,size,cellM,center,elevations:c.landscape.elevations,members,frames,runtimeMs:Date.now()-started,
    summary:{baselineMeanIoU:mean(frames.map(f=>f.baseline.iou)),updatedMeanIoU:mean(frames.map(f=>f.updated.iou)),baselineBrier:mean(frames.map(f=>f.baseline.brier))!,updatedBrier:mean(frames.map(f=>f.updated.brier))!},
    warnings:[...warnings,...c.landscape.warnings,
      ...(c.kind==='synthetic'?['Synthetic exercise. These scores are not evidence of real-world predictive accuracy.']:[]),
      ...(c.provenance.weatherKind==='reanalysis'||c.provenance.weatherKind==='observation'?['Retrospective hindcast: weather was not necessarily available at the forecast origin.']:[]),
      'Weighted member agreement is experimental and uncalibrated. It is not a validated fire probability.',
      'A fixed forecast bank is reweighted; trajectories are not restarted from new perimeters and no new physics is inferred.',
      'Spatial scores use cell centers; boundary errors use raster edge-cell centers. Resolution limits interpretation.',
      'Arrival error is distance to an observed time interval, not exact arrival error. Unreached and right-censored cells are reported separately.',
      'No model tuning or incident-level train/test aggregation occurs here. Independent incident validation remains required.']};
}
