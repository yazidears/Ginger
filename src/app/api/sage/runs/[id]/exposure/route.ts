import {NextResponse} from 'next/server';
import {readRun} from '@/lib/sage/jobs';
import {getForecastExposure} from '@/lib/sage/forecast-exposure';
export const runtime='nodejs';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}) {
  try {
    const {id}=await params;const run=await readRun(id);
    if(!run)return NextResponse.json({error:'Run not found'},{status:404});
    if(!run.result)return NextResponse.json({error:'Forecast is not complete'},{status:409});
    return NextResponse.json(await getForecastExposure(run.result),{headers:{'Cache-Control':'no-store'}});
  }catch{return NextResponse.json({error:'Forecast exposure unavailable'},{status:503});}
}
