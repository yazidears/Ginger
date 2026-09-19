import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {backendSnapshot,readPrepared,writePrepared} from '../src/lib/backend-snapshots';
async function main(){
 const original=process.cwd(),dir=await mkdtemp(join(tmpdir(),'ginger-snapshots-'));process.chdir(dir);const previousRoot=process.env.GINGER_SNAPSHOT_DIR;process.env.GINGER_SNAPSHOT_DIR=join(dir,'snapshots');
 try{
 let calls=0;const load=async()=>{calls++;await new Promise(r=>setTimeout(r,20));return {count:calls,stale:false};};const stale=(v:{count:number;stale:boolean})=>({...v,stale:true});
 const first=await Promise.all(Array.from({length:8},()=>backendSnapshot('a',load,stale)));
 assert.equal(calls,1);assert(first.every(v=>v.count===1));
 assert.equal((await backendSnapshot('a',load,stale)).count,1);assert.equal(calls,1);
 const old=await backendSnapshot('a',load,stale,0);assert.equal(old.stale,true);assert.equal(old.count,1);
 await new Promise(r=>setTimeout(r,60));assert.equal((await backendSnapshot('a',load,stale)).count,2);
 const failed=await backendSnapshot('a',async()=>{throw Error('offline');},stale,0);assert.equal(failed.stale,true);
 await new Promise(r=>setTimeout(r,10));
 await assert.rejects(()=>backendSnapshot('a',async()=>{throw Error('offline');},stale,0,0));
 await writePrepared('workspace-test',{summary:'Ready before connection'});
 assert.deepEqual(await readPrepared('workspace-test'),{summary:'Ready before connection'});
 assert.equal(await readPrepared('missing'),null);
 const refreshed=await backendSnapshot('a',load,stale,0,3600000,true);assert.equal(refreshed.stale,false);assert.equal(refreshed.count,3);
 console.log('Backend snapshots: coalescing, persisted reads, background refresh, stale labeling and expiry passed.');
 }finally{process.chdir(original);if(previousRoot===undefined)delete process.env.GINGER_SNAPSHOT_DIR;else process.env.GINGER_SNAPSHOT_DIR=previousRoot;await rm(dir,{recursive:true,force:true});}
}
void main();
