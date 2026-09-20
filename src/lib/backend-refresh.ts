import {startReceptivityRefresh} from './receptivity/engine';
import {readRegionalSnapshot} from './regional-snapshot';
import {watchAreaStore} from './watch-areas';
import {pruneSnapshots,writePrepared} from './backend-snapshots';
import {getMonitor} from './monitor';
import {prepareArea,prepareAISummary,type PreparedArea,type PreparedWorkspace} from './prepared-workspace';
const state=globalThis as typeof globalThis & {
 gingerRefreshTimer?:ReturnType<typeof setTimeout>;
 gingerAIPending?:boolean;
 gingerPlansPending?:boolean;
 gingerPreparedAreas?:PreparedArea[];
 gingerPlansPreparedAt?:string;
};
/** Publish current monitoring independently of slow local GIS assessments. */
export async function refreshWorkspace({includeAI=true}:{includeAI?:boolean}={}){
 const areas=await watchAreaStore.list();
 const [monitor,detections]=await Promise.all([getMonitor(),readRegionalSnapshot('catalonia').catch(()=>null)]);
 // Retain only plans for unchanged watch areas. Their own preparation dates remain intact.
 const prepared=(state.gingerPreparedAreas??[]).filter(p=>areas.some(a=>a.id===p.area.id&&a.lat===p.area.lat&&a.lon===p.area.lon&&a.radiusM===p.area.radiusM&&a.name===p.area.name));
 const priorities=prepared.map(p=>({id:p.area.id,name:p.area.name,headline:p.report.headline,priority:p.report.priority}));
 const review=priorities.filter(p=>p.priority!=='monitoring').length;
 const summary=state.gingerPlansPreparedAt
  ? `${prepared.length}/${areas.length} local plans assessed as of ${state.gingerPlansPreparedAt}; ${review} require review. Local plans are refreshing. ${monitor.deltas.length} recent monitoring changes recorded. These are review triggers, not confirmed fires.`
  : `${monitor.zones.length} watch areas checked. Local intervention plans are refreshing.`;
 await writePrepared('workspace-v1',{generatedAt:new Date().toISOString(),areas,monitor,detections,priorities,summary} satisfies PreparedWorkspace);
 await pruneSnapshots();
 // A stuck GIS provider must neither block monitor publication nor accumulate new jobs.
 if(state.gingerPlansPending)return;
 state.gingerPlansPending=true;
 void (async()=>{
  const prepared:PreparedArea[]=[];
  let cursor=0;
  await Promise.all(Array.from({length:Math.min(2,areas.length)},async()=>{
   for(;;){const area=areas[cursor++];if(!area)return;try{prepared.push(await prepareArea(area));}catch{console.warn('Watch-area preparation failed; will retry.');}}
  }));
  state.gingerPreparedAreas=prepared;
  state.gingerPlansPreparedAt=new Date().toISOString();
  // Publish these plans on the next monitoring tick, never overwrite a newer monitor snapshot.
  if(includeAI&&!state.gingerAIPending){state.gingerAIPending=true;void (async()=>{for(const p of prepared)await prepareAISummary(p);})().catch(()=>console.warn('Background summaries interrupted.')).finally(()=>{state.gingerAIPending=false;});}
 })().catch(()=>console.warn('Local plan refresh interrupted; will retry.')).finally(()=>{state.gingerPlansPending=false;});
}
/** Independent schedule: slow GIS preparation must not delay monitoring or receptivity. */
export function startPreventionRefresh(){
 if(state.gingerRefreshTimer)return;
 async function tick(){
  try{await refreshWorkspace({includeAI:false});}catch{console.warn('Backend refresh interrupted; will retry next cycle.');}
  finally{state.gingerRefreshTimer=setTimeout(tick,60000);state.gingerRefreshTimer.unref();}
 }
 state.gingerRefreshTimer=setTimeout(tick,1000);state.gingerRefreshTimer.unref();
}
export function startBackendRefresh(){startReceptivityRefresh();startPreventionRefresh();}
