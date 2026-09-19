import {readReplayJob,replayDirectory} from '@/lib/replay/jobs';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const {id}=await params,job=await readReplayJob(id);
    if(!job)return Response.json({error:'Replay not found.'},{status:404});
    if(new URL(request.url).searchParams.get('input')==='1'){
      const input=await readFile(path.join(replayDirectory(),`${id}.input.json`),'utf8');
      return new Response(input,{headers:{'Content-Type':'application/json','Cache-Control':'no-store','Content-Disposition':`attachment; filename="ginger-replay-input-${id}.json"`}});
    }
    if(new URL(request.url).searchParams.get('download')==='1'){
      if(!job.result)return Response.json({error:'Replay has no completed report yet.'},{status:409});
      return Response.json(job.result,{headers:{'Cache-Control':'no-store','Content-Disposition':`attachment; filename="ginger-replay-${id}.json"`}});
    }
    return Response.json(job,{headers:{'Cache-Control':'no-store'}});
  }catch{return Response.json({error:'Replay could not be read.'},{status:500});}
}
