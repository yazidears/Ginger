import {startReceptivityRefresh} from './receptivity/engine';
import {readRegionalSnapshot} from './regional-snapshot';
import {watchAreaStore} from './watch-areas';
import {pruneSnapshots,writePrepared} from './backend-snapshots';
import {getMonitor} from './monitor';
import {prepareArea,prepareAISummary,type PreparedArea,type PreparedWorkspace} from './prepared-workspace';
const state=globalThis as typeof globalThis & {gingerRefreshTimer?:ReturnType<typeof setTimeout>;gingerAIPending?:boolean};
/** Run before any client connects; publish deterministic results before AI completes. */
export async function refreshWorkspace({includeAI=true}:{includeAI?:boolean}={}){
 const areas=await watchAreaStore.list();
 const [monitor,detections]=await Promise.all([getMonitor(),readRegionalSnapshot('catalonia').catch(()=>null)]);
 // Publish fresh zone evidence before slower local GIS assessments finish.
 await writePrepared('workspace-v1',{generatedAt:new Date().toISOString(),areas,monitor,detections,priorities:[],summary:`${monitor.zones.length} watch areas checked. Local intervention plans are refreshing.`} satisfies PreparedWorkspace);
 const prepared:PreparedArea[]=[];
 let cursor=0;
 await Promise.all(Array.from({length:Math.min(2,areas.length)},async()=>{
  for(;;){const area=areas[cursor++];if(!area)return;try{prepared.push(await prepareArea(area));}catch{console.warn('Watch-area preparation failed; will retry.');}}
 }));
 const priorities=prepared.map(p=>({id:p.area.id,name:p.area.name,headline:p.report.headline,priority:p.report.priority}));
 const review=priorities.filter(p=>p.priority!=='monitoring').length;
 const workspace:PreparedWorkspace={generatedAt:new Date().toISOString(),areas,monitor,detections,priorities,summary:`${prepared.length}/${areas.length} areas assessed. ${review} require review. ${monitor.deltas.length} recent changes recorded. These are review triggers, not confirmed fires.`};
 await writePrepared('workspace-v1',workspace);
 await pruneSnapshots();
 if(includeAI&&!state.gingerAIPending){state.gingerAIPending=true;void (async()=>{for(const p of prepared)await prepareAISummary(p);})().catch(()=>console.warn('Background summaries interrupted.')).finally(()=>{state.gingerAIPending=false;});}
}
/** Independent schedule: slow GIS preparation must not delay receptivity refreshes. */
export function startPreventionRefresh(){
 if(state.gingerRefreshTimer)return;
 async function tick(){
  try{await refreshWorkspace({includeAI:false});}catch{console.warn('Backend refresh interrupted; will retry next cycle.');}
  finally{state.gingerRefreshTimer=setTimeout(tick,60000);state.gingerRefreshTimer.unref();}
 }
 state.gingerRefreshTimer=setTimeout(tick,1000);state.gingerRefreshTimer.unref();
}
export function startBackendRefresh(){startReceptivityRefresh();startPreventionRefresh();}
