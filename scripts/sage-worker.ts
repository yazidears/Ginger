import path from 'node:path';
import {readFile,rename,writeFile} from 'node:fs/promises';
import {attributeChanges} from '../src/lib/sage/attribution';
import {loadLandscape} from '../src/lib/sage/landscape';
import {IgnitionError,simulateLandscape} from '../src/lib/sage/engine';
import type {RunState} from '../src/lib/sage/types';
async function main(){
  const filename=process.argv[2];
  let state=JSON.parse(await readFile(filename,'utf8')) as RunState;
  let writes=Promise.resolve();
  const save=()=>{const snapshot=JSON.stringify(state);writes=writes.then(async()=>{const temp=`${filename}.worker.tmp`;await writeFile(temp,snapshot);await rename(temp,filename);});return writes;};
  const stage=(message:string)=>{state={...state,state:'running',stage:message,updatedAt:new Date().toISOString()};void save();};
  const timeout=setTimeout(()=>{process.exit(124);},170000);
  try{
    stage('Connecting geographic and weather sources');
    const experiment=state.request.experiment;
    let parent:RunState|undefined;
    let landscape, origin=new Date().toISOString();
    if(experiment){
      parent=JSON.parse(await readFile(path.join(path.dirname(filename),`${experiment.parentId}.json`),'utf8')) as RunState;
      if(!parent.result)throw Error('Baseline is not complete');
      if(parent.request.lat!==state.request.lat||parent.request.lon!==state.request.lon)throw Error('Keep the baseline domain; use ignition offset to move the fire');
      try{landscape=JSON.parse(await readFile(path.join(path.dirname(filename),`${experiment.parentId}.landscape.json`),'utf8'));}
      catch{throw Error('Baseline snapshot unavailable. Run a fresh baseline first.');}
      origin=experiment.observation?.observedAt||parent.result.forecastOrigin;
      const correcting=experiment.observation?.observedAt!==parent.request.experiment?.observation?.observedAt;
      experiment.windOrigin=correcting?(parent.request.experiment?.windOrigin||parent.result.forecastOrigin):parent.result.forecastOrigin;
      if(experiment.observation && (Date.parse(origin)<Date.parse(parent.result.forecastOrigin)||Date.parse(origin)>Date.parse(parent.result.forecastOrigin)+parent.request.horizonMinutes*60000))throw Error('Observation must fall within the baseline forecast');
    }else landscape=await loadLandscape([state.request.lon,state.request.lat],stage);
    await writeFile(filename.replace(/\.json$/,'.landscape.json'),JSON.stringify(landscape));
    // Stage writes during synchronous computation queue in order; flush at completion.
    const result=simulateLandscape(landscape,state.request,state.id,stage,origin);
    result.inputSnapshot=true;
    if(parent?.result&&origin===parent.result.forecastOrigin&&JSON.stringify(state.request.experiment?.observation)===JSON.stringify(parent.request.experiment?.observation)&&state.request.horizonMinutes===parent.request.horizonMinutes)result.drivers=attributeChanges(landscape,parent.result,state.request,stage);
    state={...state,state:'completed',stage:'Simulation complete',result,updatedAt:new Date().toISOString()};await save();
  }catch(e){state={...state,state:'failed',stage:'Simulation unavailable',updatedAt:new Date().toISOString(),error:e instanceof Error?e.message:'Simulation failed',ignitionRecovery:e instanceof IgnitionError?e.recovery:undefined};await save();}
  finally{clearTimeout(timeout);}
}
main().catch(()=>process.exit(1));
