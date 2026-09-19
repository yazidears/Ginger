import {NextRequest,NextResponse} from 'next/server';
import {assessLocation,validateLocation} from '@/lib/assessment';
export const runtime='nodejs';
export const maxDuration=60;
export async function GET(request:NextRequest){
 const a=request.nextUrl.searchParams.get('lat'),b=request.nextUrl.searchParams.get('lon');
 if(!a?.trim()||!b?.trim())return NextResponse.json({error:'Provide lat and lon coordinates.'},{status:400});
 const lat=Number(a),lon=Number(b);try{validateLocation(lat,lon);}catch{return NextResponse.json({error:'Invalid coordinates.'},{status:400});}
 try{return NextResponse.json(await assessLocation(lat,lon),{headers:{'Cache-Control':'private, max-age=60'}});}catch{return NextResponse.json({error:'Assessment unavailable. Please retry.'},{status:503});}
}
