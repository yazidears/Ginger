import {readRegionalSnapshot} from '@/lib/regional-snapshot';
import {NextRequest,NextResponse} from 'next/server';
import {detectionRegions} from '@/lib/detections';
export const runtime='nodejs';
export async function GET(req:NextRequest){
 const region=req.nextUrl.searchParams.get('region')||'catalonia';
 if(!Object.hasOwn(detectionRegions,region))return NextResponse.json({error:'Unknown region'},{status:400});
 try{
  const data=await readRegionalSnapshot(region as keyof typeof detectionRegions);
  return NextResponse.json(data,{headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'Satellite sources unavailable. Retry; no observations have been substituted.'},{status:503});}
}
