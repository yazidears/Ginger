import type {Landscape,RunRequest,RunResult} from './types';
import {simulateLandscape} from './engine';
/** One-at-a-time counterfactual effects. Interactions mean these do not sum to the total. */
export function attributeChanges(landscape:Landscape,parent:RunResult,next:RunRequest,onStage:(message:string)=>void=()=>{}){
 const previous=parent.request;
 const baseExperiment={parentId:parent.id,windOffset:0,windFactor:1,windShiftMinutes:0,ignitionOffset:[0,0] as [number,number],...previous.experiment};
 const target={...baseExperiment,...next.experiment};
 const cases:{name:string;request:RunRequest;changed:boolean}[]=[
  {name:'Grass spread model',changed:(previous.grassModel??'rothermel')!==(next.grassModel??'rothermel'),request:{...previous,grassModel:next.grassModel}},
  {name:'Structural transfer',changed:JSON.stringify(previous.structural)!==JSON.stringify(next.structural),request:{...previous,structural:next.structural}},
  {name:'Wind',changed:previous.windAdjustment!==next.windAdjustment||['windOffset','windFactor','windShiftMinutes'].some(k=>baseExperiment[k as keyof typeof baseExperiment]!==target[k as keyof typeof target]),request:{...previous,windAdjustment:next.windAdjustment,experiment:{...baseExperiment,windOffset:target.windOffset,windFactor:target.windFactor,windShiftMinutes:target.windShiftMinutes}}},
  {name:'Moisture',changed:previous.deadMoisturePct!==next.deadMoisturePct||previous.liveMoisturePct!==next.liveMoisturePct,request:{...previous,deadMoisturePct:next.deadMoisturePct,liveMoisturePct:next.liveMoisturePct}},
  {name:'Ignition',changed:previous.ignitionRadiusM!==next.ignitionRadiusM||JSON.stringify(baseExperiment.ignitionOffset)!==JSON.stringify(target.ignitionOffset),request:{...previous,ignitionRadiusM:next.ignitionRadiusM,experiment:{...baseExperiment,ignitionOffset:target.ignitionOffset}}},
  {name:'Fuel removal',changed:JSON.stringify(baseExperiment.fuelBreak)!==JSON.stringify(target.fuelBreak),request:{...previous,experiment:{...baseExperiment,fuelBreak:target.fuelBreak}}},
  {name:'Solar drying',changed:previous.solarDrying!==next.solarDrying,request:{...previous,solarDrying:next.solarDrying}},
 ];
 return cases.filter(c=>c.changed).map(c=>{onStage(`Isolating ${c.name.toLowerCase()}`);const run=simulateLandscape(landscape,c.request,`effect-${c.name}`,()=>{},parent.forecastOrigin);return {name:c.name,areaDeltaHa:run.stats.burnedHa-parent.stats.burnedHa,buildingDelta:run.stats.reached-parent.stats.reached};}).sort((a,b)=>Math.abs(b.areaDeltaHa)-Math.abs(a.areaDeltaHa));
}
