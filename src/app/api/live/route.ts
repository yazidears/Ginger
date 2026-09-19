import {NextRequest,NextResponse} from 'next/server';
import {firmsHotspots,FIRMS_URL} from '@/lib/providers/firms';
import {OpenMeteoWeatherProvider,OSMProvider} from '@/lib/providers/adapters';
import {DeepfireProvider} from '@/lib/providers/deepfire';
export const runtime='nodejs';
const bounds={catalonia:[.1,40.4,3.4,42.9],iberia:[-10,35,4,44],europe:[-25,34,45,72]} as const;
export async function GET(req:NextRequest){
 const region=req.nextUrl.searchParams.get('region')||'catalonia';if(!(region in bounds))return NextResponse.json({error:'Unknown region'},{status:400});
 const bbox=bounds[region as keyof typeof bounds];
 const [fire,weather,assets]=await Promise.allSettled([firmsHotspots(),new OpenMeteoWeatherProvider().current(41.30,1.86),new OSMProvider().assets()]);
 let fireResult=fire.status==='fulfilled'?fire.value:null;let fireSource=FIRMS_URL;
 if(process.env.DEEPFIRE_TOKEN||process.env.DEEPFIRE_CLIENT_ID){try{if(region==='catalonia'){fireResult=await new DeepfireProvider().hotspots();fireSource='https://docs.deepfire.co/api/hotspots';}}catch{/* Keep independently retrieved NASA observations. */}}
 const hotspots=fireResult?.data.filter(h=>h.position[0]>=bbox[0]&&h.position[0]<=bbox[2]&&h.position[1]>=bbox[1]&&h.position[1]<=bbox[3])||[];
 hotspots.sort((a,b)=>Date.parse(b.provenance.observedAt)-Date.parse(a.provenance.observedAt));
 const statuses=[{id:'fire',name:'Satellite detections',status:fireResult?.status||'unavailable',detail:fireResult?.detail||'Satellite request failed; no detections fabricated.',url:fireSource},{id:'weather',name:'Garraf weather',status:weather.status==='fulfilled'?weather.value.status:'unavailable',detail:weather.status==='fulfilled'?weather.value.detail:'Weather request failed.',url:'https://open-meteo.com/en/docs'},{id:'assets',name:'Garraf infrastructure',status:assets.status==='fulfilled'?assets.value.status:'unavailable',detail:assets.status==='fulfilled'?assets.value.detail:'Overpass unavailable; asset locations and capacities are unknown.',url:'https://www.openstreetmap.org/copyright'}];
 return NextResponse.json({mode:'live',region,retrievedAt:new Date().toISOString(),satelliteRetrievedAt:fireResult?.updatedAt||null,latestObservation:hotspots[0]?.provenance.observedAt||null,hotspots,weather:weather.status==='fulfilled'?weather.value:null,assets:assets.status==='fulfilled'?assets.value.data:{type:'FeatureCollection',features:[]},statuses},{headers:{'Cache-Control':'private, max-age=60'}});
}
