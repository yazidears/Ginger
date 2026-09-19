import {loadEnvConfig} from '@next/env';
loadEnvConfig(process.cwd());
async function main(){
 const {startPreventionRefresh}=await import('../src/lib/backend-refresh');
 startPreventionRefresh();
 const {refreshReceptivity}=await import('../src/lib/receptivity/engine');
 const {maintainGeography}=await import('./receptivity/maintain-geography');
 let lastGeographyCheck=0;
 console.log('GINGER SAGE: refreshing Barcelona fire receptivity every 15 minutes.');
 for(;;){if(Date.now()-lastGeographyCheck>86400000){lastGeographyCheck=Date.now();void maintainGeography().catch(e=>console.warn('[SAGE] Geography refresh failed; previous dated layers retained.',e instanceof Error?e.message:'Unknown failure'));}try{const snapshot=await refreshReceptivity();console.log(`[SAGE] ${snapshot.generatedAt}: ${snapshot.counts.assessed} cells, ${snapshot.stations.length} XEMA stations.`);}catch(e){console.warn('[SAGE] Refresh failed; previous snapshot retained with original timestamps.',e instanceof Error?e.message:'Unknown failure');}await new Promise(resolve=>setTimeout(resolve,15*60000));}
}
void main();
