import {assessLocation} from '@/lib/assessment';
import {recordThermalHistory} from '@/lib/sage/thermal-store';
import {thermalTracks} from '@/lib/sage/thermal';
export const runtime='nodejs';
export async function GET(request:Request){
 const url=new URL(request.url),lat=Number(url.searchParams.get('lat')),lon=Number(url.searchParams.get('lon'));
 if(!url.searchParams.has('lat')||!url.searchParams.has('lon')||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>85||Math.abs(lon)>180)return Response.json({error:'Use valid coordinates'},{status:400});
 try{
  const assessment=await assessLocation(lat,lon);
  const all=await recordThermalHistory(assessment.satellite.hotspots);
   const weather=assessment.weather.current;
   const result={tracks:thermalTracks(all,[lon,lat],weather,Date.now(),assessment.geography.landcover),generatedAt:assessment.generatedAt,sources:assessment.sources,weather:weather?{windKmh:weather.windKmh,humidityPct:weather.humidityPct}:null};
  return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Thermal evidence unavailable. Retry refresh.'},{status:503});}
}
