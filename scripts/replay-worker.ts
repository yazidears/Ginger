import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import path from 'node:path';
import {runReplay} from '../src/lib/replay/engine';
import {replayDirectory} from '../src/lib/replay/jobs';
import type {ReplayJob} from '../src/lib/replay/types';

const id=process.argv[2];
if(!/^[0-9a-f-]{36}$/.test(id))throw Error('Invalid replay job ID');
const root=replayDirectory(),file=path.join(root,`${id}.json`);
let state=JSON.parse(readFileSync(file,'utf8')) as ReplayJob;
const save=()=>{state.updatedAt=new Date().toISOString();writeFileSync(`${file}.worker.tmp`,JSON.stringify(state));renameSync(`${file}.worker.tmp`,file);};
try{
  const input=JSON.parse(readFileSync(path.join(root,`${id}.input.json`),'utf8'));
  const result=runReplay(input,stage=>{state={...state,state:'running',stage};save();});
  state={...state,state:'completed',stage:'Replay complete',result};save();
}catch(e){state={...state,state:'failed',stage:'Replay failed',error:e instanceof Error?e.message:'Replay calculation failed.'};save();process.exitCode=1;}
