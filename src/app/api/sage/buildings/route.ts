import {readBuildingInventory} from '@/lib/sage/building-inventory';
export const runtime='nodejs';
export async function GET(request:Request){
  const q=new URL(request.url).searchParams,lat=Number(q.get('lat')),lon=Number(q.get('lon'));
  if(!q.has('lat')||!q.has('lon')||!Number.isFinite(lat)||!Number.isFinite(lon)||lat<40.53||lat>42.86||lon<.16||lon>3.3)return Response.json({error:'Select a location in Catalonia'},{status:400});
  try{return Response.json(await readBuildingInventory([Number(lon.toFixed(5)),Number(lat.toFixed(5))]),{headers:{'Cache-Control':'no-store'}});}
  catch{return Response.json({error:'Building inventory unavailable. Coverage is incomplete; retry before interpreting the map.'},{status:503});}
}
