import 'server-only';
import {mkdir,readFile,writeFile,rename,rm,readdir,stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import type {RunRequest,RunState} from './types';
export const runDirectory=()=>path.resolve(process.env.SAGE_RUN_DIR||path.join(process.cwd(),'.sage-runs'));
const validId=(id:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
export async function saveRun(state:RunState,root=runDirectory()){
  const filename=path.join(root,`${state.id}.json`),temp=`${filename}.${process.pid}.tmp`;
  await writeFile(temp,JSON.stringify(state));await rename(temp,filename);
}
export async function readRun(id:string):Promise<RunState|null>{
  if(!validId(id))return null;
  try {
    const state=JSON.parse(await readFile(path.join(runDirectory(),`${id}.json`),'utf8')) as RunState;
    if((state.state==='queued'||state.state==='running')&&Date.now()-Date.parse(state.createdAt)>180000){return {...state,state:'failed',stage:'Stopped',error:'The simulation exceeded its 3-minute budget. Retry the run.'};}
    return state;
  } catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}
}
export class BusyError extends Error {}
export async function startRun(request:RunRequest){
  const root=runDirectory();await mkdir(root,{recursive:true});
  const lock=path.join(root,'active');
  try{await mkdir(lock);}catch(e){
    if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;
    const age=Date.now()-(await stat(lock)).mtimeMs;
    if(age<210000)throw new BusyError('Another simulation is running. Please wait for it to finish.');
    await rm(lock,{recursive:true,force:true});await mkdir(lock);
  }
  const now=new Date().toISOString(),id=randomUUID();
  const state:RunState={id,state:'queued',stage:'Preparing simulation',createdAt:now,updatedAt:now,request};
  try{
    await saveRun(state);
    // The numerical worker is a separate process, never on the Next request/event loop.
    const child=spawn(process.execPath,['--conditions=react-server','--import','tsx',path.join(process.cwd(),'scripts/sage-worker.ts'),path.join(root,`${id}.json`)],{cwd:process.cwd(),stdio:'ignore',env:process.env});
    const timer=setTimeout(()=>child.kill('SIGKILL'),175000);timer.unref();
    child.once('error',async()=>{clearTimeout(timer);await saveRun({...state,state:'failed',stage:'Worker failed',updatedAt:new Date().toISOString(),error:'Simulation worker could not start.'}).catch(()=>{});await rm(lock,{recursive:true,force:true});});
    child.once('exit',async code=>{clearTimeout(timer);if(code!==0){const current=await readRun(id);if(current&&current.state!=='completed'&&current.state!=='failed')await saveRun({...current,state:'failed',stage:'Worker stopped',error:'Simulation worker stopped before completing.',updatedAt:new Date().toISOString()}).catch(()=>{});}await rm(lock,{recursive:true,force:true});});
    // Bound disk retention; no deletion of active runs.
    for(const entry of await readdir(root)){if(entry.endsWith('.json')){const p=path.join(root,entry);if(Date.now()-(await stat(p)).mtimeMs>7*86400000)await rm(p);}}
    return state;
  }catch(e){await rm(lock,{recursive:true,force:true});throw e;}
}

export async function listRuns(){
  const root=runDirectory();await mkdir(root,{recursive:true});
  const files=(await readdir(root)).filter(f=>validId(f.replace(/\.json$/,'')));
  const settled=await Promise.allSettled(files.map(async f=>{const r=await readRun(f.slice(0,-5));return r?{id:r.id,state:r.state,createdAt:r.createdAt,request:r.request,stats:r.result?.stats}:null;}));
  const runs=settled.flatMap(r=>r.status==='fulfilled'&&r.value?[r.value]:[]);
  if(files.length&&!runs.length&&settled.some(r=>r.status==='rejected'))throw Error('Saved runs cannot be read');
  return runs.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,40);
}
