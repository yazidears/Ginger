import 'server-only';
import {randomUUID} from 'node:crypto';
import {readRun,listRuns,startRun} from './sage/jobs';
import {readOperations,mutateOperations} from './operations';
import {readPrepared} from './backend-snapshots';
import type {PreparedWorkspace} from './prepared-workspace';
import {distanceKm} from './simulation';
import type {AshRoom, AshToolName, RoomProposal} from './ash-room-types';
import type {RunResult} from './sage/types';
import type {ScenarioContext} from './product-contracts';
import {appendRoomEvent,AshRoomError,boundedText,checkpointRoom,requireRoomMember} from './ash-room-store';

export async function selectedForecast(room:AshRoom){if(!room.runId)throw new AshRoomError('Select a completed Sage forecast to use this tool.',409);const state=await readRun(room.runId);if(!state?.result||state.state!=='completed')throw new AshRoomError('The selected forecast is unavailable or incomplete.',409);return state.result;}
export function forecastSummary(run:RunResult){const scenario=(run as RunResult&{scenario?:ScenarioContext}).scenario;return {name:scenario?.assessment?.name||scenario?.name||'Selected fire forecast',runId:run.id,model:run.model||{name:run.engine},issuedAt:run.generatedAt,forecastOrigin:run.forecastOrigin,horizonMinutes:run.request.horizonMinutes,basis:run.request.mode==='scenario'?'hypothetical':'operator-confirmed incident',confirmationBasis:run.request.confirmation||null,scenarioId:scenario?.id||null,assessmentId:scenario?.assessment?.id||null,center:run.center,assumptions:run.assumptions,warnings:run.warnings,sources:run.sources,weather:run.weather,statsTimeMinutes:run.request.horizonMinutes,statsMeaning:'End-of-horizon model totals; use asset_exposure for the selected minute.',stats:run.stats};}
const sameContext=(a:RunResult,b:{request:RunResult['request']})=>a.request.mode===b.request.mode&&a.request.confirmation===b.request.confirmation&&Math.abs(a.request.lat-b.request.lat)<0.00001&&Math.abs(a.request.lon-b.request.lon)<0.00001;
async function currentObservations(run:RunResult){
  // Consume the prepared feed only: conversation never initiates another model or ingestion job.
  const [workspace,operations]=await Promise.all([readPrepared<PreparedWorkspace>('workspace-v1').catch(()=>null),readOperations()]);
  const detections=workspace?.detections;
  const nearby=detections?.hotspots.filter(h=>h.provenance.mode!=='demo'&&distanceKm(run.center,h.position)<=5).slice(0,20)||[];
  const status=!detections?'unavailable':detections.status==='unavailable'?'unavailable':detections.status==='stale'||!detections.retrievedAt||Date.now()-Date.parse(detections.retrievedAt)>30*60000?'stale':'available';
  return {scope:'Prepared satellite detections and operator reports within 5 km; these do not alter the selected immutable forecast.',status,retrievedAt:detections?.retrievedAt||null,latestObservation:nearby.map(h=>h.provenance.observedAt).filter(t=>Number.isFinite(Date.parse(t))).sort().at(-1)||null,thermalDetections:nearby.map(h=>({id:h.id,position:h.position,source:h.provenance.source,observedAt:h.provenance.observedAt,retrievedAt:h.provenance.retrievedAt,newerThanForecast:Date.parse(h.provenance.observedAt)>Date.parse(run.generatedAt),qualification:'Thermal anomaly; wildfire confirmation required.'})),fieldReports:operations.observations.filter(o=>distanceKm(run.center,[o.location.lon,o.location.lat])<=5).slice(0,20),limitation:'Missing detections are not evidence of no fire. Field reports remain operator-entered and unverified.'};
}
export const ashTools=[
  {name:'incident_status',description:'Retrieve the room incident or hypothetical scenario, evidence dates, and selected forecast basis before answering operational questions.',parameters:{type:'object',properties:{},additionalProperties:false}},
  {name:'latest_forecast',description:'Retrieve selected and latest completed Sage forecast for this room context. Does not silently change the room run.',parameters:{type:'object',properties:{},additionalProperties:false}},
  {name:'asset_exposure',description:'Retrieve computed exposure from the selected Sage run at a modelled minute. Roads are projected exposure, never closures or safe routes. Missing coverage is unknown.',parameters:{type:'object',properties:{minute:{type:'number',description:'Minutes from the selected forecast origin; omit for room time.'},category:{type:'string',enum:['road','healthcare','school','building','complex','gathering']}},additionalProperties:false}},
  {name:'compare_forecasts',description:'Compare the selected forecast with its immutable parent or a directly related alternative. No independent forecast and no homes-saved claim.',parameters:{type:'object',properties:{otherRunId:{type:'string'}},additionalProperties:false}},
  {name:'operational_history',description:'Retrieve timestamped room activity, unresolved draft proposals, and unverified nearby field reports.',parameters:{type:'object',properties:{},additionalProperties:false}},
  {name:'propose_action',description:'Prepare a draft task, unverified field report, or rerun proposal. This does not perform it. An operator must separately review and approve using the room action card. Never evacuation, dispatch, road closure or public messaging.',parameters:{type:'object',properties:{kind:{type:'string',enum:['draft-task','field-report','new-run']},text:{type:'string'}},required:['kind','text'],additionalProperties:false}},
].map(tool=>({type:'function' as const,...tool}));

export async function executeAshTool(room:AshRoom,memberId:string,name:AshToolName,args:Record<string,unknown>={}){
  const member=requireRoomMember(room,memberId);const run=await selectedForecast(room);
  const reference={placeName:forecastSummary(run).name,roomId:room.id,runId:run.id,minute:room.minute,forecastOrigin:run.forecastOrigin,issuedAt:run.generatedAt};
  let result:Record<string,unknown>,summary:string;
  if(name==='incident_status'){
    result={...reference,incident:room.incident,forecast:forecastSummary(run),observations:room.incident?.evidence||[],currentObservations:await currentObservations(run),limitation:room.basis==='confirmed-incident'?(room.incident?'Operator confirmation is retained; no emergency authority is inferred.':'An operator confirmation reference exists, but structured incident observations and their observation times are unavailable.'):'This is an explicitly hypothetical scenario; no confirmed current wildfire is asserted.'};summary=room.basis==='confirmed-incident'?'Incident and available observation evidence retrieved.':'Hypothetical scenario basis and available observations retrieved.';
  }else if(name==='latest_forecast'){
    const runs=await listRuns();const newest=runs.find(r=>r.state==='completed'&&sameContext(run,r));const latest=newest&&newest.id!==run.id?(await readRun(newest.id))?.result:null;
    result={...reference,selected:forecastSummary(run),latest:forecastSummary(latest||run),changed:Boolean(latest),scope:'Same ignition coordinates, scenario/incident mode and confirmation reference. Newest does not mean more accurate.'};summary=latest?'A newer forecast is available; the room remains on its selected run.':'Selected and latest matching forecast retrieved.';
  }else if(name==='asset_exposure'){
    const minute=args.minute===undefined?room.minute:Number(args.minute);if(!Number.isFinite(minute)||minute<0||minute>run.request.horizonMinutes)throw new AshRoomError('Select a minute inside this forecast horizon.');
    const [{getForecastExposure},{exposureAtMinute}]=await Promise.all([import('./sage/forecast-exposure'),import('./sage/forecast-exposure-summary')]);
    const exposure=await getForecastExposure(run);const view=exposureAtMinute(exposure,minute);const category=typeof args.category==='string'?args.category:undefined;
    const central=view.central.filter(a=>!category||a.category===category),sensitivity=view.sensitivity.filter(a=>!category||a.category===category);
    result={...reference,minute,exposureStatus:exposure.status,inventory:exposure.inventory,counts:view.counts,roadSegments:view.roadSegments,namedRoads:view.namedRoads,central:central.slice(0,40),sensitivity:sensitivity.slice(0,40),omitted:Math.max(0,central.length-40),limitations:exposure.limitations,meaning:'Calculated modelled exposure, not confirmed damage, closure, occupancy, or route safety. Sensitivity members are not probabilities.'};
    summary=`Exposure evidence retrieved at +${Math.round(minute)} min${category?` · ${category}`:''}.`;
  }else if(name==='compare_forecasts'){
    const id=typeof args.otherRunId==='string'?args.otherRunId:run.request.experiment?.parentId;if(!id)throw new AshRoomError('This run has no comparison selected. Create a supported alternative in Sage first.',409);
    const other=(await readRun(id))?.result;if(!other)throw new AshRoomError('Comparison forecast unavailable.',404);
    const related=run.request.experiment?.parentId===other.id||other.request.experiment?.parentId===run.id||Boolean(run.request.experiment?.parentId&&run.request.experiment.parentId===other.request.experiment?.parentId);
    if(!related)throw new AshRoomError('Compare a directly related Sage baseline or alternative only. Independent runs may use incompatible inputs.',409);
    const comparable=run.forecastOrigin===other.forecastOrigin&&run.request.horizonMinutes===other.request.horizonMinutes&&run.engine===other.engine&&run.model?.version===other.model?.version&&Boolean(run.inputSnapshot&&other.inputSnapshot);
    result={...reference,selected:forecastSummary(run),other:forecastSummary(other),comparable,difference:comparable?{burnedHa:run.stats.burnedHa-other.stats.burnedHa,modelledBuildingsReached:run.stats.reached-other.stats.reached}:null,meaning:comparable?'Difference between modelled assumptions, not assets saved.':'Numerical difference withheld: matching issue origin, horizon, model version and retained input snapshots are required.'};summary=comparable?'Related forecast assumptions and outcome difference retrieved.':'Related forecasts retrieved; numerical comparison withheld for incompatible or missing context.';
  }else if(name==='operational_history'){
    const operations=await readOperations();const nearby=(p:{lat:number;lon:number})=>Math.abs(p.lat-run.request.lat)<0.025&&Math.abs(p.lon-run.request.lon)<0.025;
    result={...reference,events:room.events.slice(-20),proposals:room.proposals.filter(p=>p.status==='pending'),tasks:operations.tasks.filter(t=>nearby(t.location)&&t.status!=='completed').slice(0,20),observations:operations.observations.filter(o=>nearby(o.location)).slice(0,20),scope:'Room events plus records within a coordinate bounding box of the selected scenario; field reports remain unverified.'};summary='Room history and unverified field reports retrieved.';
  }else if(name==='propose_action'){
    if(args.kind!=='draft-task'&&args.kind!=='field-report'&&args.kind!=='new-run')throw new AshRoomError('Unsupported action.');
    const text=boundedText(args.text,1000,'Proposal');
    if(args.kind==='draft-task'&&/\b(evacuat(?:e|ion)|dispatch|close\s+(?:the\s+)?road|send\s+(?:an?\s+)?(?:alert|warning))\b/i.test(text))throw new AshRoomError('Ash cannot issue emergency actions. Propose an evidence review instead.',403);
    if(room.proposals.filter(p=>p.status==='pending').length>=20)throw new AshRoomError('Review pending proposals before creating more.',409);
    const proposal:RoomProposal={id:randomUUID(),kind:args.kind,text,createdBy:member.name,createdAt:new Date().toISOString(),status:'pending' as const,runId:run.id};room.proposals.push(proposal);room.proposals=room.proposals.filter(p=>p.status==='pending'||room.proposals.indexOf(p)>=room.proposals.length-60);
    result={...reference,proposal,authorizationRequired:true,message:'Prepared only. The operator must review and select Approve in the room. No task, observation or run has been created.'};summary=`${args.kind==='field-report'?'Unverified report':args.kind==='new-run'?'Sage rerun':'Draft task'} awaits operator approval.`;
  }else throw new AshRoomError('Tool not permitted.',403);
  const event=appendRoomEvent(room,member.name,'tool',summary);if(typeof result.minute==='number')event.minute=result.minute;return result;
}

/** Only the separate operator confirmation endpoint calls this; never exposed as an AI tool. */
export async function approveRoomProposal(room:AshRoom,memberId:string,proposalId:string,decision:'approve'|'reject'){
  const member=requireRoomMember(room,memberId),proposal=room.proposals.find(p=>p.id===proposalId);if(!proposal)throw new AshRoomError('Proposal not found.',404);if(proposal.status!=='pending')throw new AshRoomError('This proposal has already been handled.',409);
  if(proposal.runId!==room.runId)throw new AshRoomError('The forecast context changed. Create a new proposal.',409);
  if(decision==='reject'){proposal.status='rejected';appendRoomEvent(room,member.name,'session','Proposal declined.','operator-authorised');return proposal;}
  proposal.status='executing';
  // A process crash after the operation must not permit a second approval and duplicate write.
  // An interrupted executing proposal requires operator inspection, never an automatic retry.
  await checkpointRoom(room);
  try{
    const run=await selectedForecast(room);const location={name:room.name,lat:run.request.lat,lon:run.request.lon};
    if(proposal.kind==='new-run'){
      const state=await startRun({...run.request});proposal.resultId=state.id;
    }else{
      const state=await mutateOperations(proposal.kind==='field-report'?{action:'add-observation',text:proposal.text,location}:{action:'create-task',title:`Draft: ${proposal.text.slice(0,220)}`,priority:'routine',location});proposal.resultId=proposal.kind==='field-report'?state.observations[0]?.id:state.tasks[0]?.id;
    }
    proposal.status='approved';appendRoomEvent(room,member.name,proposal.kind==='new-run'?'forecast':proposal.kind,`${proposal.kind==='field-report'?'Unverified field report recorded':proposal.kind==='new-run'?'New Sage run requested':'Draft review task recorded'}: ${proposal.text}`,'operator-authorised');
  }catch(error){proposal.status='failed';proposal.error=error instanceof Error?error.message:'Action failed.';appendRoomEvent(room,member.name,'session',`Approved proposal failed: ${proposal.error}`,'operator-authorised');}
  return proposal;
}

/** Text fallback performs the same scoped tool retrieval; it is not represented as a language model. */
export function toolForQuestion(question:string):{name:AshToolName;args:Record<string,unknown>}{
  if(/observation|thermal|detection/i.test(question)&&!/record|report/i.test(question))return {name:'incident_status',args:{}};
  if(/\b(report|record|task|rerun|new run)\b/i.test(question))return {name:'propose_action',args:{kind:/\b(report|record)\b/i.test(question)?'field-report':/rerun|new run/i.test(question)?'new-run':'draft-task',text:question}};
  if(/road|hospital|care|school|expos|risk|affect|building/i.test(question))return {name:'asset_exposure',args:{...(/road/i.test(question)?{category:'road'}:/hospital|care/i.test(question)?{category:'healthcare'}:/school/i.test(question)?{category:'school'}:{})}};
  if(/compar|difference|since.*forecast/i.test(question))return {name:'compare_forecasts',args:{}};
  if(/changed|latest|newer|forecast/i.test(question))return {name:'latest_forecast',args:{}};
  if(/history|team|unresolved/i.test(question))return {name:'operational_history',args:{}};
  return {name:'incident_status',args:{}};
}
