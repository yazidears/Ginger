import {readReceptivity} from '@/lib/receptivity/engine';
import {highReceptivityTrigger} from '@/lib/exposure/model';
import {readExposure} from '@/lib/exposure/store';
export const runtime='nodejs';
export const dynamic='force-dynamic';
/** Resolve the cell and its hazard signal on the server; clients cannot invent a hazard score. */
export async function GET(request:Request){
 const query=new URL(request.url).searchParams,id=query.get('cell'),raw=query.get('horizon')||'0',horizon=Number(raw);
 if(!id||id.length>200||!raw.trim()||![0,1,3,6,12,24].includes(horizon))return Response.json({error:'Valid cell and forecast horizon required.'},{status:400});
 const result=await readReceptivity(),snapshot=result.snapshot;
 if(!snapshot)return Response.json({error:'Cell assessment is preparing.'},{status:202});
 const cell=snapshot.cells.find(c=>c.id===id);
 if(!cell)return Response.json({error:'Cell not found.'},{status:404});
 const score=cell.receptivity[snapshot.horizons.indexOf(horizon)]??null;
 const exposure=await readExposure(cell.center[0],cell.center[1],Math.ceil(snapshot.cellSizeM/Math.sqrt(2)),highReceptivityTrigger(score,result.stale));
 exposure.detail+=' Cell exposure uses its enclosing circle and a 1 km buffer. Here, fresh fire receptivity ≥65/100 activates the exposure contribution. The vegetation receptivity and spread scores are unchanged.';
 exposure.detail=exposure.detail.replace('Exposure raises review priority only when weather or thermal triggers are present; not a fire probability.','This is an exposure review rule, not a fire probability.');
 return Response.json({exposure,cellId:cell.id,receptivity:score,horizon,assessmentAt:snapshot.generatedAt,stale:result.stale},{headers:{'Cache-Control':'no-store'}});
}
