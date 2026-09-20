import type {ScenarioContext} from '../product-contracts';
import type {Landscape, RunRequest, WeatherFrame} from './types';

/** Frames declare the interval they actually support; sparse forecasts never fill intervening hours. */
export function weatherAt(frames: WeatherFrame[], at: number) {
  return frames.find(frame => Date.parse(frame.time) <= at && at < Date.parse(frame.time) + (frame.validForMinutes ?? 60) * 60000);
}
export function validateScenarioForRun(context: ScenarioContext, request: RunRequest) {
  if(context.center.some((value,i)=>Math.abs(value-[request.lon,request.lat][i])>1e-6))throw Error('Scenario location differs from its immutable evidence. Create a new scenario for another location.');
  if(context.basis==='hypothetical'&&request.mode!=='scenario')throw Error('Prevent exploration remains hypothetical. Confirm an incident with its own evidence first.');
  if(context.basis==='confirmed-incident'&&context.incident?.confirmation!=='confirmed')throw Error('Incident confirmation evidence is missing.');
  const origin=Date.parse(context.ignitionAt);if(!Number.isFinite(origin))throw Error('Scenario ignition time is invalid.');
  if(!context.assessment&&!context.inputs.weather.length){
    if(origin<Date.now()-48*3600000||origin>Date.now()+(context.basis==='confirmed-incident'?60000:48*3600000))throw Error('Scenario origin needs captured historical weather outside the supported 48-hour retrieval window.');
    return;
  }
  if(!request.experiment){
    for(let minute=0;minute<=request.horizonMinutes;minute+=30){
      const frame=weatherAt(context.inputs.weather,origin+minute*60000);
      if(!frame)throw Error(`Captured weather does not cover +${minute} minutes. Choose a shorter horizon or capture a scenario with continuous forecast forcing.`);
      if(request.solarDrying&&(frame.directNormalWm2===null||frame.diffuseWm2===null))throw Error('Solar drying requires measured or forecast direct and diffuse radiation. Disable solar drying for this captured scenario.');
    }
  }
}
export function applyScenarioContext(landscape: Landscape, context: ScenarioContext, request: RunRequest): Landscape {
  validateScenarioForRun(context,request);
  const weather=context.inputs.weather.map(frame=>({...frame}));
  const warnings=[...landscape.warnings,...context.limitations];
  if(weather.some(frame=>frame.directNormalWm2===null||frame.diffuseWm2===null))warnings.push('Direct and diffuse radiation unavailable in the captured evidence; solar drying must be disabled and solar exposure is withheld.');
  if(context.inputs.deadMoisturePct!==null)warnings.push(`Captured FFMC-derived fine-fuel estimate: ${context.inputs.deadMoisturePct.toFixed(1)}%. Run starts at ${request.deadMoisturePct}%${Math.abs(context.inputs.deadMoisturePct-request.deadMoisturePct)>.05?' (operator override)':''}; this is not a site fuel-moisture measurement.`);
  return {...landscape,weather,warnings,sources:[...landscape.sources,...context.evidence.filter(e=>e.consumers.some(c=>/sage|spread|weather/i.test(c))).map(e=>({name:e.source,url:e.url??'',retrievedAt:e.retrievedAt??context.createdAt,detail:`${e.detail} Valid: ${e.validAt??e.observedAt??'unknown'}; effective resolution: ${e.resolutionM??'unknown'} m. ${e.coverage} coverage.`}))]};
}
