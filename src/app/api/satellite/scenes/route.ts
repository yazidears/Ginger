import {NextRequest,NextResponse} from 'next/server';
import {parseLabQuery} from '@/lib/satellite-lab';
import {sentinelScenes} from '@/lib/providers/sentinel';
export async function GET(req:NextRequest){let q;try{q=parseLabQuery(req.nextUrl.searchParams);}catch{return NextResponse.json({error:'Invalid coordinates'},{status:400});}try{return NextResponse.json(await sentinelScenes(q.lat,q.lon));}catch{return NextResponse.json({error:'Sentinel-2 catalog unavailable. Retry scene discovery.'},{status:503});}}
