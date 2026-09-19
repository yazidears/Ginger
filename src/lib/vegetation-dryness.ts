import {hourlyFFMC, moistureFromFFMC} from './receptivity/model';
import type {WeatherHour} from './assessment';

export const DRYNESS_VERSION = 'fine-fuel-dryness-1';
const HOUR = 3_600_000;
export type DrynessLevel = 'extremely_dry' | 'very_dry' | 'dry' | 'moist';
export type DrynessFrame = {time:string;moisturePct:number;ffmc:number;level:DrynessLevel};
export type VegetationDryness = {
 version:string;status:'estimated'|'unavailable'|'stale';
 current:DrynessFrame|null;outlook:DrynessFrame[];driest:DrynessFrame|null;
 historyHours:number;initializationSpreadPct:number|null;
 source:string;detail:string;limitations:string[];liveFuelMoisturePct:null;
};
// Product display bands, not official danger classes or validated ignition thresholds.
export const drynessLevel = (moisture:number):DrynessLevel => moisture < 6 ? 'extremely_dry' : moisture < 10 ? 'very_dry' : moisture < 16 ? 'dry' : 'moist';
export const drynessLabel = (level:DrynessLevel) => ({extremely_dry:'Extremely dry',very_dry:'Very dry',dry:'Dry',moist:'Moist'})[level];
const limitations = [
 'Weather-derived estimate for dead fine fuels where present; not a vegetation observation or measured moisture.',
 'Live plant moisture, fuel quantity, species, canopy shading and local soil conditions are unknown.',
 'Display bands: extremely dry below 6%, very dry below 10%, dry below 16% of dry mass. Ginger screening bands, not official danger classes or ignition probabilities.',
 'Hourly FFMC initialized at 85 before 72 hours of modelled weather. Initial values 60 and 95 check sensitivity; this range is not a confidence interval.',
];
export function estimateVegetationDryness(history:WeatherHour[] = [], outlook:WeatherHour[] = [], now = Date.now()):VegetationDryness {
 const result:VegetationDryness = {version:DRYNESS_VERSION,status:'unavailable',current:null,outlook:[],driest:null,historyHours:0,initializationSpreadPct:null,source:'Open-Meteo modelled weather · hourly FFMC',detail:'72 continuous hours of recent weather are required to estimate dead fine-fuel moisture.',limitations:[...limitations],liveFuelMoisturePct:null};
 const start = Math.floor(now/HOUR)*HOUR;
 const valid = (h:WeatherHour) => [h.temperatureC,h.humidityPct,h.windKmh,h.precipitationMm].every(v=>typeof v==='number'&&Number.isFinite(v)) && h.temperatureC >= -60 && h.temperatureC <= 60 && h.humidityPct >= 0 && h.humidityPct <= 100 && h.windKmh >= 0 && h.precipitationMm >= 0;
 // Never bridge missing hours, deduplicate conflicting observations, or use future history.
 const past = history.filter(h=>Date.parse(h.time)>start-72*HOUR && Date.parse(h.time)<=start);
 if(past.length!==72 || past.some((h,i)=>!valid(h)||Date.parse(h.time)!==start-(71-i)*HOUR))return result;
 result.historyHours=72;
 if(outlook.length!==24 || outlook.some((h,i)=>!valid(h)||Date.parse(h.time)!==start+i*HOUR)){
  result.detail='The current 24-hour weather outlook is missing, stale or incomplete. Dryness assessment withheld.';return result;
 }
 const last=past[71],first=outlook[0];
 if(['temperatureC','humidityPct','windKmh','precipitationMm'].some(k=>last[k as keyof WeatherHour]!==first[k as keyof WeatherHour])){
  result.detail='Weather history and the current outlook disagree. Dryness assessment withheld.';return result;
 }
 const step=(code:number,h:WeatherHour)=>hourlyFFMC(code,{temperature:h.temperatureC,relativeHumidity:h.humidityPct,windSpeed:h.windKmh,precipitation:h.precipitationMm,stepHours:1});
 let code=85,wet=60,dry=95;
 for(const h of past){code=step(code,h);wet=step(wet,h);dry=step(dry,h);}
 const spread=Math.abs(moistureFromFFMC(wet)-moistureFromFFMC(dry));
 result.initializationSpreadPct=Number(spread.toFixed(2));
 if(spread>2){result.detail='Moisture remains sensitive to the assumed starting condition after 72 hours. Estimate withheld until more reliable history is available.';return result;}
 const frame=(h:WeatherHour):DrynessFrame=>{const moisture=moistureFromFFMC(code);return {time:h.time,ffmc:Number(code.toFixed(2)),moisturePct:Number(moisture.toFixed(2)),level:drynessLevel(Number(moisture.toFixed(2)))};};
 const frames=[frame(first)];
 // The current hour was already processed in history, including its preceding-hour rain.
 for(const h of outlook.slice(1)){code=step(code,h);frames.push(frame(h));}
 result.status='estimated';result.current=frames[0];result.outlook=frames;
 result.driest=frames.reduce((min,f)=>f.moisturePct<min.moisturePct?f:min);
 result.detail=`Estimated dead fine-fuel moisture: ${result.current.moisturePct.toFixed(1)}% of dry mass (${drynessLabel(result.current.level).toLowerCase()}). Live vegetation moisture is not measured.`;
 return result;
}
export const extremeDrynessHours = (dryness:VegetationDryness|undefined) => dryness?.status==='estimated' ? dryness.outlook.filter(f=>f.level==='extremely_dry') : [];
