import {mkdir,readFile,writeFile,rename,rm,readdir,stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import type {ReplayCase,ReplayJob} from './types';

export const replayDirectory=()=>path.resolve(process.env.GINGER_REPLAY_DIR||'.ginger-data/replays');
const validId=(id:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
export async function saveReplayJob(state:ReplayJob){
  const file=path.join(replayDirectory(),`${state.id}.json`),temporary=`${file}.${process.pid}.tmp`;
  await writeFile(temporary,JSON.stringify(state));await rename(temporary,file);
}
export async function readReplayJob(id:string):Promise<ReplayJob|null>{
  if(!validId(id))return null;
  try{
    const state=JSON.parse(await readFile(path.join(replayDirectory(),`${id}.json`),'utf8')) as ReplayJob;
    if(['queued','running'].includes(state.state)&&Date.now()-Date.parse(state.createdAt)>180000)return {...state,state:'failed',error:'Replay exceeded its three-minute compute budget.',stage:'Stopped'};
    return state;
  }catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}
}
export class ReplayBusyError extends Error{}
export async function startReplay(c:ReplayCase):Promise<ReplayJob>{
  const root=replayDirectory();await mkdir(root,{recursive:true});const lock=path.join(root,'active');
  try{await mkdir(lock);}catch(e){
    if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;
    if(Date.now()-(await stat(lock)).mtimeMs<210000)throw new ReplayBusyError('A replay is already running. Wait for it to finish.');
    await rm(lock,{recursive:true,force:true});await mkdir(lock);
  }
  const id=randomUUID(),now=new Date().toISOString();
  const state:ReplayJob={id,state:'queued',stage:'Preparing frozen input snapshot',createdAt:now,updatedAt:now,name:c.name};
  let released=false;
  const release=async()=>{if(released)return;released=true;await rm(lock,{recursive:true,force:true});};
  try{
    await writeFile(path.join(root,`${id}.input.json`),JSON.stringify(c));await saveReplayJob(state);
    const child=spawn(process.execPath,['--import','tsx',path.join(process.cwd(),'scripts/replay-worker.ts'),id],{cwd:process.cwd(),stdio:'ignore',env:process.env});
    const timer=setTimeout(()=>child.kill('SIGKILL'),175000);timer.unref();
    child.once('error',()=>{void (async()=>{clearTimeout(timer);await saveReplayJob({...state,state:'failed',stage:'Worker failed',error:'Replay worker could not start.'});await release();})().catch(()=>{});});
    child.once('exit',()=>{void (async()=>{clearTimeout(timer);const latest=await readReplayJob(id);if(latest&&latest.state!=='completed'&&latest.state!=='failed')await saveReplayJob({...latest,state:'failed',stage:'Worker stopped',error:'Replay worker stopped before completing.'});await release();})().catch(()=>{});});
    // Retention failure must not release an active worker's lock.
    try{for(const file of await readdir(root))if(/^[0-9a-f-]+(?:\.input)?\.json$/.test(file)&&Date.now()-(await stat(path.join(root,file))).mtimeMs>7*86400000)await rm(path.join(root,file));}catch{/* Try retention again on the next job. */}
    return state;
  }catch(e){await release();throw e;}
}
export async function listReplayJobs(){
  const root=replayDirectory();await mkdir(root,{recursive:true});
  const files=(await readdir(root)).filter(f=>validId(f.replace(/\.json$/,'')));
  const jobs=await Promise.all(files.map(f=>readReplayJob(f.slice(0,-5))));
  return jobs.filter((j):j is ReplayJob=>!!j).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,20).map(({result,...state})=>({...state,kind:result?.kind,summary:result?.summary}));
}
