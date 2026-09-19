import {readOperations} from './operations';
import {createHash} from 'node:crypto';
import {readPrepared,writePrepared} from './backend-snapshots';
import {assessLocation,type Assessment} from './assessment';
import {deriveIntelligence,type Intelligence} from './intelligence';
import {buildPreventionPlan,type PlanAction} from './prevention-plan';
import {reasonAboutLocation,sageConfiguration} from './sage/reasoning';
import type {WatchArea} from './watch-areas';
import type {MonitorSnapshot} from './monitor';
import type {DetectionSnapshot} from './detections';
export type PreparedArea={area:WatchArea;assessment:Assessment;report:Intelligence;plan:PlanAction[];preparedAt:string;fingerprint:string;ai?:Awaited<ReturnType<typeof reasonAboutLocation>>;aiFingerprint?:string;aiAttemptAt?:string;aiStatus:'pending'|'ready'|'unavailable'|'outdated'};
export type PreparedWorkspace={generatedAt:string;areas:WatchArea[];monitor:MonitorSnapshot;detections:DetectionSnapshot|null;summary:string;priorities:{id:string;name:string;headline:string;priority:Intelligence['priority']}[]};
export const areaKey=(lat:number,lon:number)=>`prepared-area-v3-exposure-dryness:${lat.toFixed(5)}:${lon.toFixed(5)}`;
export async function prepareArea(area:WatchArea){
 const assessment=await assessLocation(area.lat,area.lon,true),report=deriveIntelligence(assessment),plan=buildPreventionPlan(assessment);
 const prior=await readPrepared<PreparedArea>(areaKey(area.lat,area.lon));
 const operations=await readOperations().catch(()=>null);
 const fingerprint=createHash('sha256').update(JSON.stringify({operations,exposure:assessment.exposure,vegetationDryness:assessment.vegetationDryness,weather:assessment.weather,satellite:assessment.satellite,sources:assessment.sources.map(s=>[s.source,s.status]),geography:assessment.geography,deepfire:assessment.deepfire?.clusters})).digest('hex');
 const value:PreparedArea={area,assessment,report,plan,preparedAt:new Date().toISOString(),fingerprint,ai:prior?.ai,aiFingerprint:prior?.aiFingerprint,aiAttemptAt:prior?.aiAttemptAt,aiStatus:prior?.ai?(prior.aiFingerprint===fingerprint?'ready':'outdated'):'pending'};
 await writePrepared(areaKey(area.lat,area.lon),value);return value;
}
/** Persist attempt time before inference: failures/restarts do not create a tight retry loop. */
export async function prepareAISummary(value:PreparedArea){
 if(!sageConfiguration().configured){value.aiStatus='unavailable';await writePrepared(areaKey(value.area.lat,value.area.lon),value);return;}
 const age=Date.now()-Date.parse(value.aiAttemptAt||'1970-01-01');
 if(age<30*60000||(value.ai&&value.aiFingerprint===value.fingerprint&&Date.now()-Date.parse(value.ai.generatedAt)<6*3600000))return;
 value.aiAttemptAt=new Date().toISOString();await writePrepared(areaKey(value.area.lat,value.area.lon),value);
 try{
  value.ai=await reasonAboutLocation({question:'Prepare a concise shift briefing for prevention and inspection: main concern, next three checks, relevant weather timing, evidence gaps. Cite supplied sources. Maximum 180 words.',history:[],lat:value.area.lat,lon:value.area.lon},value.assessment);
  value.aiFingerprint=value.fingerprint;value.aiStatus='ready';
 }catch{value.aiStatus=value.ai?'outdated':'unavailable';}
 const latest=await readPrepared<PreparedArea>(areaKey(value.area.lat,value.area.lon));
 if(latest&&latest.preparedAt!==value.preparedAt){
  latest.ai=value.ai;latest.aiAttemptAt=value.aiAttemptAt;latest.aiFingerprint=value.aiFingerprint;
  latest.aiStatus=value.ai?(latest.fingerprint===value.aiFingerprint?'ready':'outdated'):'unavailable';
  await writePrepared(areaKey(value.area.lat,value.area.lon),latest);
 }else await writePrepared(areaKey(value.area.lat,value.area.lon),value);
}
