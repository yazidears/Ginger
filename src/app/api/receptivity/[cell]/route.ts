import {assessPriorities} from '@/lib/receptivity/priority';
import {readReceptivity} from '@/lib/receptivity/engine';
import {explainCell,classify} from '@/lib/receptivity/model';
import {HORIZONS,type Horizon} from '@/lib/receptivity/types';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{cell:string}>}){
 const {cell:id}=await params;const h=Number(new URL(request.url).searchParams.get('horizon')??0);
 if(!HORIZONS.includes(h as Horizon))return Response.json({error:'Use horizon 0, 1, 3, 6, 12 or 24 hours.'},{status:400});
 const result=await readReceptivity(),snapshot=result.snapshot;
 if(!snapshot)return Response.json({error:result.error||'Live assessment is being prepared.'},{status:503,headers:{'Retry-After':'15'}});
 const cell=snapshot.cells.find(c=>c.id===id);if(!cell)return Response.json({error:'Cell outside assessed vegetation coverage.'},{status:404});
 const localReview=assessPriorities({...snapshot,cells:[cell]},HORIZONS.indexOf(h as Horizon)).byCell.get(cell.id);
 const station=snapshot.stations.find(s=>s.station.id===cell.stationId),assessment=station?.frames.find(f=>f.horizon===h);
 if(!station||!assessment)return Response.json({cell:id,available:false,localReview,reason:'Required weather or forecast coverage is unavailable.'},{status:200});
 const i=HORIZONS.indexOf(h as Horizon),score=cell.receptivity[i]!;
 return Response.json({cell:id,name:cell.name,center:cell.center,timestamp:assessment.timestamp,computedAt:snapshot.generatedAt,stale:result.stale,horizon:h,localReview,fireReceptivity:score,spreadPotential:cell.spread[i],classification:classify(score),confidence:cell.confidence,confidenceMeaning:'Evidence completeness heuristic, not a probability',velocity:cell.velocity,conditions:{...assessment.conditions,...station.history,fineFuelMoisture:assessment.fineFuelMoisture,ffmc:assessment.ffmc,isi:assessment.isi},evidence:cell.evidence,heatwave:snapshot.heatwaves?.find(h=>h.id===cell.evidence?.heatwaveId),satelliteSource:snapshot.satellite?{source:snapshot.satellite.source,status:snapshot.satellite.status,retrievedAt:snapshot.satellite.retrievedAt}:null,fuel:cell.fuel,terrain:cell.terrain,provenance:{station:station.station.name,stationDistanceKm:cell.stationDistanceKm,forecastSource:station.forecastSource,forecastIssuedAt:station.forecastIssuedAt,model:snapshot.version},explanation:explainCell(cell,station,h as Horizon)},{headers:{'Cache-Control':'no-store'}});
}
