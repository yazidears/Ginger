const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
async function main(){
 const writes=[],timers=[];let ai=0,receptivity=0,release;
 const localReady=new Promise(resolve=>{release=resolve;});
 const monitor={zones:[{id:'zone'}],deltas:[]};
 const area={id:'zone',name:'Test area',lat:41.7,lon:1.8,radiusM:1500};
 const prepared={area,report:{headline:'Review test evidence',priority:'review'}};
 const modules={
  './receptivity/engine':{startReceptivityRefresh:()=>receptivity++},
  './regional-snapshot':{readRegionalSnapshot:async()=>({hotspots:[]})},
  './watch-areas':{watchAreaStore:{list:async()=>[area]}},
  './backend-snapshots':{pruneSnapshots:async()=>{},writePrepared:async(key,value)=>{writes.push({key,value});}},
  './monitor':{getMonitor:async()=>monitor},
  './prepared-workspace':{prepareArea:async()=>{await localReady;return prepared;},prepareAISummary:async()=>{ai++;}},
 };
 const module={exports:{}};
 const context={module,exports:module.exports,require:id=>{assert.ok(modules[id],id);return modules[id];},console,Date,Promise,setTimeout:(run,delay)=>{const timer={run,delay,unref(){}};timers.push(timer);return timer;}};
 const code=ts.transpileModule(fs.readFileSync('src/lib/backend-refresh.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,context);
 const api=module.exports;
 api.startPreventionRefresh();api.startPreventionRefresh();
 assert.equal(timers.length,1,'One prevention scheduler per process');
 assert.equal(receptivity,0,'Prevention schedule does not restart receptivity');
 const running=timers[0].run();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(writes.length,1,'Zone evidence is published before local GIS finishes');
 assert.equal(writes[0].value.monitor,monitor);
 assert.equal(writes[0].value.priorities.length,0);
 release();await running;
 assert.equal(writes.length,2);
 assert.equal(writes[1].value.priorities[0].id,'zone');
 assert.equal(ai,0,'Deterministic prevention refresh does not trigger AI inference');
 assert.equal(timers[1].delay,60000);
 api.startBackendRefresh();assert.equal(receptivity,1);assert.equal(timers.length,2);
 console.log('PASS prevention scheduler independence, deduplication, early evidence delivery, final plans and inference boundary');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
