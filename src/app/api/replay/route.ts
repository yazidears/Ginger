import {demonstrationCase} from '@/lib/replay/fixture';
import {validateReplayCase} from '@/lib/replay/validation';
import {listReplayJobs,ReplayBusyError,startReplay} from '@/lib/replay/jobs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request){
  if(new URL(request.url).searchParams.get('template')==='1')return Response.json(demonstrationCase(),{headers:{'Content-Disposition':'attachment; filename="ginger-replay-template.json"','Cache-Control':'no-store'}});
  try{return Response.json({jobs:await listReplayJobs()},{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'Saved replay history could not be read.'},{status:500});}
}
export async function POST(request:Request){
  try{
    const reader=request.body?.getReader();if(!reader)return Response.json({error:'Request body required.'},{status:400});
    const parts:Uint8Array[]=[];let bytes=0;
    while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>3_000_000){await reader.cancel();return Response.json({error:'Replay import exceeds 3 MB.'},{status:413});}parts.push(part.value);}
    const payload=JSON.parse(Buffer.concat(parts).toString('utf8'));
    const input=validateReplayCase(payload?.demo===true?demonstrationCase():payload);
    const job=await startReplay(input);return Response.json(job,{status:202,headers:{'Cache-Control':'no-store'}});
  }catch(e){return Response.json({error:e instanceof Error?e.message:'Replay could not start.'},{status:e instanceof ReplayBusyError?409:400});}
}
