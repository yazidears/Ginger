import {refreshReceptivity} from '../../src/lib/receptivity/engine';
async function main(){const s=await refreshReceptivity();console.log(JSON.stringify({generatedAt:s.generatedAt,counts:s.counts,stations:s.stations.length,sources:s.sources.map(x=>({name:x.name,status:x.status,validAt:x.validAt})),top:s.cells.filter(x=>x.receptivity[0]!==null).sort((a,b)=>b.receptivity[0]!-a.receptivity[0]!).slice(0,3).map(x=>({name:x.name,score:x.receptivity[0]})),warnings:s.warnings},null,2));

}
main().catch(e=>{console.error(e);process.exitCode=1;});
