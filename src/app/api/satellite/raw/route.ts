import {NextRequest,NextResponse} from 'next/server';
import {parseLabQuery,sensorPasses} from '@/lib/satellite-lab';
import {firmsHotspots} from '@/lib/providers/firms';
import {satelliteBounds} from '@/lib/providers/satellite';
import type {FeatureCollection} from 'geojson';
export async function GET(req:NextRequest){let q;try{q=parseLabQuery(req.nextUrl.searchParams);}catch{return NextResponse.json({error:'Invalid coordinates.'},{status:400});}
 if(q.lat<34||q.lat>72||q.lon< -25||q.lon>45)return NextResponse.json({error:'The configured FIRMS sensor feed covers Europe only.'},{status:422});
 try{const b=satelliteBounds(q.lat,q.lon,25),r=await firmsHotspots();const observations:FeatureCollection={type:'FeatureCollection',features:r.data.filter(h=>h.position[0]>=b[0]&&h.position[0]<=b[2]&&h.position[1]>=b[1]&&h.position[1]<=b[3]).map(h=>({type:'Feature',id:h.id,geometry:{type:'Point',coordinates:h.position},properties:{...h.raw,source:'VIIRS_NOAA20_NRT',observed_at:h.provenance.observedAt,fire_radiative_power:h.frpMw}}))};return NextResponse.json({observations,passes:sensorPasses(observations),status:r.status,retrievedAt:r.updatedAt,detail:'NASA FIRMS NOAA-20 VIIRS Level-2 fire-product fields, last 24 hours. Brightness temperatures are band measurements, not ground temperature. This feed is separate from Deepfire to avoid double counting.'});}catch{return NextResponse.json({error:'NASA sensor feed unavailable.'},{status:503});}}
