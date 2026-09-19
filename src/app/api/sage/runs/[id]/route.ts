import {NextResponse} from 'next/server';
import {readRun} from '@/lib/sage/jobs';
export const runtime='nodejs';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
  try{const {id}=await params;const run=await readRun(id);return NextResponse.json(run||{error:'Run not found'},{status:run?200:404,headers:{'Cache-Control':'no-store'}});}
  catch{return NextResponse.json({error:'Run status unavailable'},{status:503});}
}
