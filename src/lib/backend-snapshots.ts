import {mkdir,readFile,writeFile,rename,unlink,readdir,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';

type Snapshot<T>={version:1;savedAt:number;value:T};
const globals=globalThis as typeof globalThis & {gingerSnapshotPending?:Map<string,Promise<unknown>>};
const pending=globals.gingerSnapshotPending??=new Map();
const root=()=>process.env.GINGER_SNAPSHOT_DIR||join(homedir(),'.cache','ginger-backend',createHash('sha256').update(process.cwd()).digest('hex').slice(0,16));
/** Shared disk snapshots survive restarts. One refresh per key per server process. */
export async function backendSnapshot<T>(key:string,load:()=>Promise<T>,stale:(value:T)=>T,ttl=300000,maxAge=3600000,waitForRefresh=false):Promise<T>{
 const file=join(root(),createHash('sha256').update(key).digest('hex')+'.json');
 let snapshot:Snapshot<T>|undefined;
 try{const candidate=JSON.parse(await readFile(file,'utf8')) as Snapshot<T>;if(candidate.version===1&&Number.isFinite(candidate.savedAt)&&candidate.savedAt<=Date.now())snapshot=candidate;}catch{/* Missing/corrupt snapshot is a cold request. */}
 const refresh=()=>{
  const existing=pending.get(file);if(existing)return existing as Promise<T>;
  if(pending.size>=32)return Promise.reject(new Error('Snapshot refresh capacity reached'));
  const work=(async()=>{const value=await load();await mkdir(root(),{recursive:true,mode:0o700});const temp=file+'.'+randomUUID()+'.tmp';
   try{await writeFile(temp,JSON.stringify({version:1,savedAt:Date.now(),value}),{mode:0o600});await rename(temp,file);}finally{await unlink(temp).catch(()=>{});}
   return value;
  })().finally(()=>pending.delete(file));pending.set(file,work);return work;
 };
 if(snapshot&&Date.now()-snapshot.savedAt<ttl)return snapshot.value;
 if(!waitForRefresh&&snapshot&&Date.now()-snapshot.savedAt<maxAge){void refresh().catch(()=>{});return stale(structuredClone(snapshot.value));}
 return refresh();
}
/** Bound disk growth from arbitrary inspected coordinates. */
export async function pruneSnapshots(){
 const files=await readdir(root()).catch(()=>[]);
 const entries=await Promise.all(files.filter(f=>f.endsWith('.json')).map(async name=>({name,time:(await stat(join(root(),name)).catch(()=>null))?.mtimeMs??0})));
 entries.sort((a,b)=>b.time-a.time);
 await Promise.all(entries.slice(128).map(e=>unlink(join(root(),e.name)).catch(()=>{})));
}

/** Read-only delivery never starts provider work. */
export async function readPrepared<T>(key:string):Promise<T|null>{
 try{return JSON.parse(await readFile(join(root(),createHash('sha256').update(key).digest('hex')+'.json'),'utf8')).value as T;}catch{return null;}
}
export async function writePrepared<T>(key:string,value:T){
 await mkdir(root(),{recursive:true,mode:0o700});
 const file=join(root(),createHash('sha256').update(key).digest('hex')+'.json'),temp=file+'.'+randomUUID()+'.tmp';
 try{await writeFile(temp,JSON.stringify({version:1,savedAt:Date.now(),value}),{mode:0o600});await rename(temp,file);}finally{await unlink(temp).catch(()=>{});}
}
