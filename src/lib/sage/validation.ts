import {validateExperiment} from './investigation';
import type {RunRequest} from './types';
export function validateRunRequest(raw:unknown):RunRequest {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Provide a simulation request');
  const v=raw as Record<string,unknown>;
  if(v.scenarioId!==undefined&&(typeof v.scenarioId!=='string'||!/^[-a-zA-Z0-9_]{1,100}$/.test(v.scenarioId)))throw Error('Invalid scenario identity');
  const number=(name:string,min:number,max:number)=>{const n=v[name];if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max)throw Error(`${name} must be between ${min} and ${max}`);return n;};
  const lat=number('lat',40.53,42.86),lon=number('lon',.16,3.30);
  const horizonMinutes=number('horizonMinutes',60,240);if(![60,120,240].includes(horizonMinutes))throw Error('Select a 60, 120 or 240 minute forecast');
  if(v.mode!=='scenario'&&v.mode!=='confirmed')throw Error('Choose scenario or confirmed incident');
  if(typeof v.confirmation!=='string'||v.confirmation.length>240)throw Error('Confirmation reference must be at most 240 characters');
  if(v.mode==='confirmed'&&v.confirmation.trim().length<5)throw Error('Provide the operator confirmation reference for this incident');
  if(typeof v.solarDrying!=='boolean')throw Error('Specify whether to model solar drying');
  if(v.grassModel!==undefined&&v.grassModel!=='rothermel'&&v.grassModel!=='ginger-o2')throw Error('Choose the surface physics or experimental GingerO2 grass model');
  let structural:RunRequest['structural'];
  if(v.structural!==undefined){
    if(!v.structural||typeof v.structural!=='object'||Array.isArray(v.structural))throw Error('Invalid structural scenario');
    const p=v.structural as Record<string,unknown>;
    if(typeof p.maxGapM!=='number'||!Number.isFinite(p.maxGapM)||p.maxGapM<0||p.maxGapM>50||typeof p.transferMinutes!=='number'||!Number.isFinite(p.transferMinutes)||p.transferMinutes<1||p.transferMinutes>120)throw Error('Structural scenario requires a 0–50 m gap and 1–120 minute transfer delay');
    structural={maxGapM:p.maxGapM,transferMinutes:p.transferMinutes};
  }
  return {...(v.scenarioId?{scenarioId:v.scenarioId as string}:{}),...(v.grassModel!==undefined?{grassModel:v.grassModel}:{}),...(structural?{structural}:{}),...(v.experiment ? {experiment:validateExperiment(v.experiment)} : {}),lat,lon,horizonMinutes:horizonMinutes as RunRequest['horizonMinutes'],mode:v.mode,confirmation:v.confirmation.trim(),solarDrying:v.solarDrying,ignitionRadiusM:number('ignitionRadiusM',25,200),deadMoisturePct:number('deadMoisturePct',1,60),liveMoisturePct:number('liveMoisturePct',30,300),windAdjustment:number('windAdjustment',.1,1)};
}
