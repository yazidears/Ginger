import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import type {Hotspot} from '../providers/types';
const shared=globalThis as typeof globalThis & {gingerThermalWrites?:Map<string,Promise<unknown>>};
const queues=shared.gingerThermalWrites??=new Map();
export async function recordThermalHistory(incoming:Hotspot[],file=path.join(process.cwd(),'.ginger-data','thermal-history.json')):Promise<Hotspot[]>{
 const work=async()=>{
  await mkdir(path.dirname(file),{recursive:true});let previous:Hotspot[]=[];
  try{previous=JSON.parse(await readFile(file,'utf8'));if(!Array.isArray(previous))throw Error('Invalid thermal history');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  const now=Date.now();
  const all=[...new Map([...previous,...incoming].map(h=>[h.id,h])).values()].filter(h=>h.provenance.mode==='live'&&Number.isFinite(Date.parse(h.provenance.observedAt))&&Date.parse(h.provenance.observedAt)<=now+60000&&now-Date.parse(h.provenance.observedAt)<30*86400000).sort((a,b)=>b.provenance.observedAt.localeCompare(a.provenance.observedAt)).slice(0,20000);
  await writeFile(`${file}.tmp`,JSON.stringify(all));await rename(`${file}.tmp`,file);return all;
 };
 const result=(queues.get(file)??Promise.resolve()).then(work,work);queues.set(file,result.catch(()=>{}));return result;
}
