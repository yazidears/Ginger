import {NextResponse} from 'next/server';
import {BusyError,ScenarioInputError,startRun,listRuns} from '@/lib/sage/jobs';
import {validateRunRequest} from '@/lib/sage/validation';
export const runtime='nodejs';
export async function GET(){
  try { return NextResponse.json(await listRuns(),{headers:{'Cache-Control':'no-store'}}); }
  catch { return NextResponse.json({error:'Run history unavailable'},{status:503}); }
}
export async function POST(request:Request){
  let input;
  try{
    if(!request.headers.get('content-type')?.includes('application/json'))throw Error('Send a JSON request');
    const reader=request.body?.getReader();if(!reader)throw Error('Request body is required');
    const chunks:Uint8Array[]=[];let length=0;
    while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>65536){await reader.cancel();throw Error('Simulation request is too large');}chunks.push(value);}
    input=validateRunRequest(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Invalid request'},{status:400});}
  try{return NextResponse.json(await startRun(input),{status:202,headers:{'Cache-Control':'no-store'}});}
  catch(e){return NextResponse.json({error:e instanceof BusyError||e instanceof ScenarioInputError?e.message:'Unable to start simulation'},{status:e instanceof BusyError?409:e instanceof ScenarioInputError?422:503});}
}
