import {readPrepared} from '@/lib/backend-snapshots';
import {areaKey,type PreparedArea,type PreparedWorkspace} from '@/lib/prepared-workspace';
import {validateLocation} from '@/lib/assessment';
export const runtime='nodejs';
export const dynamic='force-dynamic';
/** Delivery only: connecting a client never triggers analysis or inference. */
export async function GET(request:Request){
 const query=new URL(request.url).searchParams;
 let key='workspace-v1';
 if(query.has('lat')||query.has('lon')){
  if(!query.get('lat')?.trim()||!query.get('lon')?.trim())return Response.json({error:'Both coordinates are required.'},{status:400});
  const lat=Number(query.get('lat')),lon=Number(query.get('lon'));
  try{validateLocation(lat,lon);}catch{return Response.json({error:'Invalid coordinates.'},{status:400});}
  key=areaKey(lat,lon);
 }
 const data=await readPrepared<PreparedArea|PreparedWorkspace>(key);
 if(!data)return Response.json({status:'warming'},{status:202,headers:{'Cache-Control':'no-store','Retry-After':'5'}});
 const updated='preparedAt' in data?data.preparedAt:data.generatedAt;
 return Response.json({data,stale:Date.now()-Date.parse(updated)>10*60000},{headers:{'Cache-Control':'no-store'}});
}
