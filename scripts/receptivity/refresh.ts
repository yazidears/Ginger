import {loadEnvConfig} from '@next/env';
import {setTimeout as delay} from 'node:timers/promises';
// Load local provider configuration before importing modules that read it.
loadEnvConfig(process.cwd());

async function main(){
 const watch=process.argv.includes('--watch');
 const {refreshReceptivity}=await import('../../src/lib/receptivity/engine');
 const stopping=new AbortController();
 const stop=()=>stopping.abort();
 if(watch){process.once('SIGINT',stop);process.once('SIGTERM',stop);}
 try{
  do{
   try{
    const s=await refreshReceptivity();
    console.log(JSON.stringify({generatedAt:s.generatedAt,counts:s.counts,stations:s.stations.length,sources:s.sources.map(x=>({name:x.name,status:x.status,validAt:x.validAt})),warnings:s.warnings},null,2));
   }catch(error){
    if(!watch)throw error;
    console.error('[Prevent] Refresh failed; retaining the previous dated snapshot.',error instanceof Error?error.message:'Unknown failure');
   }
   if(!watch||stopping.signal.aborted)break;
   console.log(`[Prevent] Next refresh after 15 minutes. PID ${process.pid}; runtime ${process.cwd()}`);
   // Await completion before scheduling again: slow providers never create overlapping cycles.
   await delay(15*60000,undefined,{signal:stopping.signal}).catch(error=>{if(!stopping.signal.aborted)throw error;});
  }while(!stopping.signal.aborted);
 }finally{
  if(watch){process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
