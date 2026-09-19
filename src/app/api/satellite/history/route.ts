import {NextRequest,NextResponse} from 'next/server';
import {DeepfireProvider,deepfireConfigured} from '@/lib/providers/deepfire';
import {satelliteBounds} from '@/lib/providers/satellite';
import {firmsHotspots} from '@/lib/providers/firms';
import {cached} from '@/lib/providers/http';
import {parseLabQuery,sensorPasses,type SatelliteArchive} from '@/lib/satellite-lab';
import type {FeatureCollection} from 'geojson';
export const runtime='nodejs';
export async function GET(req:NextRequest){
 let query;try{query=parseLabQuery(req.nextUrl.searchParams);}catch(e){return NextResponse.json({error:(e as Error).message},{status:400});}
 try{const result=await cached(`satellite-archive:${query.lat}:${query.lon}:${query.days}`,60000,async()=>{
 const {lat,lon,days}=query,bounds=satelliteBounds(lat,lon,25),end=new Date().toISOString(),start=new Date(Date.now()-days*86400000).toISOString();
 const result:SatelliteArchive={bounds,start,end,retrievedAt:end,observations:{type:'FeatureCollection',features:[]},perimeters:{type:'FeatureCollection',features:[]},passes:[],sources:[]};
 const provider=new DeepfireProvider();
 const results=await Promise.allSettled(['hotspots','satellite-perimeters'].map(name=>deepfireConfigured()?provider.history(name as 'hotspots'|'satellite-perimeters',bounds,start,end):Promise.reject(Error('unconfigured'))));
 for(const [i,r] of results.entries()){result.sources.push({name:i===0?'Deepfire observation history':'Deepfire perimeter history',status:r.status==='fulfilled'?'live':'unavailable',detail:r.status==='fulfilled'?'Complete bounded query; acquisition and computation times are retained.':'Archive unavailable or incomplete; no empty coverage is claimed.'});if(r.status==='fulfilled')result[i===0?'observations':'perimeters']=r.value as FeatureCollection;}
 if(results[0].status==='rejected'&&lat>=34&&lat<=72&&lon>=-25&&lon<=45){try{const fallback=await firmsHotspots();result.observations={type:'FeatureCollection',features:fallback.data.filter(h=>h.position[0]>=bounds[0]&&h.position[0]<=bounds[2]&&h.position[1]>=bounds[1]&&h.position[1]<=bounds[3]&&Date.parse(h.provenance.observedAt)>=Date.parse(start)&&Date.parse(h.provenance.observedAt)<=Date.parse(end)).map(h=>({type:'Feature',id:h.id,geometry:{type:'Point',coordinates:h.position},properties:{...h.raw,source:'VIIRS_NOAA20_NRT',observed_at:h.provenance.observedAt,fire_radiative_power:h.frpMw,confidence:h.confidence}}))};result.sources.push({name:'NASA FIRMS fallback',status:fallback.status==='live'?'live':'unavailable',detail:'Public Europe file covers only the last 24 hours, not the full requested archive. '+fallback.detail});}catch{result.sources.push({name:'NASA FIRMS fallback',status:'unavailable',detail:'Fallback request failed.'});}}
 result.passes=sensorPasses(result.observations);return result;});
 return NextResponse.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'Satellite archive is unavailable.'},{status:503});}
}
