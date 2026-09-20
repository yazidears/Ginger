const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
async function main(){
 const writes=[],timers=[];let ai=0,receptivity=0,release,preparations=0,scan=0;
 const localReady=new Promise(resolve=>{release=resolve;});
 const monitor={zones:[{id:'zone'}],deltas:[]};
 let areas;
 const area={id:'zone',name:'Test area',lat:41.7,lon:1.8,radiusM:1500};
 areas=[area];
 const prepared={area,report:{headline:'Review test evidence',priority:'review'}};
 const modules={
  './receptivity/engine':{startReceptivityRefresh:()=>receptivity++},
  './regional-snapshot':{readRegionalSnapshot:async()=>({hotspots:[]})},
  './watch-areas':{watchAreaStore:{list:async()=>areas}},
  './backend-snapshots':{pruneSnapshots:async()=>{},writePrepared:async(key,value)=>{writes.push({key,value});}},
  './monitor':{getMonitor:async()=>({...monitor,lastScan:`scan-${++scan}`})},
  './prepared-workspace':{prepareArea:async()=>{preparations++;await localReady;return prepared;},prepareAISummary:async()=>{ai++;}},
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
 assert.equal(writes[0].value.monitor.lastScan,'scan-1');
 assert.equal(writes[0].value.priorities.length,0);
 const finished=await Promise.race([running.then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),100))]);
 assert.equal(finished,true,'Monitor tick must finish even if GIS never resolves');
 assert.equal(timers[1].delay,60000,'Next monitor tick is scheduled while GIS is still blocked');
 await timers[1].run();
 assert.equal(writes.length,2,'A second snapshot is published while GIS is blocked');
 assert.equal(writes[1].value.monitor.lastScan,'scan-2');
 assert.equal(preparations,1,'Blocked GIS work stays single-flight across monitor ticks');
 release();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(writes.length,2,'GIS completion cannot overwrite a newer monitor snapshot');
 await timers[2].run();
 assert.equal(writes[2].value.monitor.lastScan,'scan-3');
 assert.equal(writes[2].value.priorities[0].id,'zone');
 assert.match(writes[2].value.summary,/local plans assessed as of/,'Plan age remains explicit');
 await new Promise(resolve=>setImmediate(resolve));
 areas=[{...area,lat:42}];
 await timers[3].run();
 assert.equal(writes[3].value.priorities.length,0,'Moved areas cannot inherit old local plans');
 assert.equal(ai,0,'Deterministic prevention refresh does not trigger AI inference');
 assert.equal(timers[1].delay,60000);
 api.startBackendRefresh();assert.equal(receptivity,1);assert.equal(timers.length,5);
 console.log('PASS prevention scheduler independence, deduplication, repeated fresh evidence while GIS is blocked, bounded GIS work, dated plans and inference boundary');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
