import {loadEnvConfig} from '@next/env';
loadEnvConfig(process.cwd());
async function main(){
 const {refreshReceptivity}=await import('../src/lib/receptivity/engine');
 console.log('GINGER SAGE: refreshing Barcelona fire receptivity every 15 minutes.');
 for(;;){try{const snapshot=await refreshReceptivity();console.log(`[SAGE] ${snapshot.generatedAt}: ${snapshot.counts.assessed} cells, ${snapshot.stations.length} XEMA stations.`);}catch(e){console.warn('[SAGE] Refresh failed; previous snapshot retained with original timestamps.',e instanceof Error?e.message:'Unknown failure');}await new Promise(resolve=>setTimeout(resolve,15*60000));}
}
void main();
