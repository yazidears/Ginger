import thresholds from '../../../data/receptivity/heat-thresholds-2026.json';
import type {Station,Weather} from './types';
import {diskCache} from './providers';
import {fetchJSON} from '../providers/http';

export const HEAT_THRESHOLD_SOURCE=thresholds.source;
export type HeatDay={date:string;maximumC:number|null;kind:'modelled-history'|'forecast'|'observed-samples'|'observations-and-forecast';complete?:boolean};
export type HeatForecast={days:HeatDay[];retrievedAt:string;status:'live'|'unavailable';source?:string;detail?:string};
export type HeatEpisode={start:string;end:string;days:number;peakC:number;phase:'past'|'ongoing'|'forecast'};
export type Heatwave={id:string;stationId:string;municipality:string;thresholdC:number|null;status:'unavailable'|'incomplete'|'none'|'watch'|'ongoing'|'forecast';days:HeatDay[];episodes:HeatEpisode[];retrievedAt:string|null;source?:string;detail?:string};
export const localDate=(now:number)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const normalize=(name:string)=>name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/’/g,"'").trim();
const byName=new Map(thresholds.municipalities.map(t=>[normalize(t.name),t.maximumC]));
export function heatThreshold(name:string):number|null{return byName.get(normalize(name))??null;}
const dayNumber=(date:string)=>Date.parse(date+'T12:00:00Z')/86400000;

/** A model-based screening against the published local threshold, not an official warning. */
export function classifyHeatwave(stationId:string,municipality:string,forecast:HeatForecast,now=Date.now()):Heatwave{
 const thresholdC=heatThreshold(municipality),today=localDate(now),days=forecast.days;
 const result:Heatwave={id:stationId+':'+municipality,stationId,municipality,thresholdC,status:'unavailable',days,episodes:[],retrievedAt:forecast.status==='live'?forecast.retrievedAt:null,source:forecast.source,detail:forecast.detail};
 if(thresholdC===null||forecast.status!=='live')return result;
 let run:HeatDay[]=[];
 const flush=()=>{if(run.length>=3){const start=run[0].date,end=run.at(-1)!.date;result.episodes.push({start,end,days:run.length,peakC:Math.max(...run.map(d=>d.maximumC!)),phase:end<today?'past':start>today?'forecast':'ongoing'});}run=[];};
 for(const d of days){if(run.length&&dayNumber(d.date)-dayNumber(run.at(-1)!.date)!==1)flush();if(d.maximumC!==null&&d.maximumC>thresholdC)run.push(d);else flush();}flush();
 const future=days.filter(d=>d.date>=today),complete=future.length>=7&&future.every((d,i)=>d.maximumC!==null&&d.complete!==false&&dayNumber(d.date)===dayNumber(today)+i);
 result.status=result.episodes.some(e=>e.phase==='ongoing')?'ongoing':result.episodes.some(e=>e.phase==='forecast')?'forecast':!complete?'incomplete':future.some(d=>d.maximumC!==null&&d.maximumC>thresholdC)?'watch':'none';
 return result;
}
export function parseHeatForecast(raw:unknown,now=Date.now()):HeatForecast{
 const d=raw as {timezone?:string;daily_units?:{temperature_2m_max?:string};daily?:{time?:unknown[];temperature_2m_max?:unknown[]}};
 const dates=d?.daily?.time,temperatures=d?.daily?.temperature_2m_max;
 if(d?.timezone!=='Europe/Madrid'||d.daily_units?.temperature_2m_max!=='°C'||!Array.isArray(dates)||!Array.isArray(temperatures)||dates.length!==temperatures.length)throw Error('Invalid daily heat forecast');
 const today=localDate(now);let previous='';
 const days:HeatDay[]=dates.map((date,i)=>{if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(dayNumber(date))||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date||date<=previous)throw Error('Invalid heat forecast dates');previous=date;const t=temperatures[i];return {date,maximumC:typeof t==='number'&&Number.isFinite(t)&&t>=-60&&t<=60?t:null,kind:date<today?'modelled-history':'forecast'};});
 return {days,retrievedAt:new Date(now).toISOString(),status:'live',source:'Open-Meteo',detail:'Daily maxima; past dates are modelled history, not station observations.'};
}
type MetHeat={properties:{meta:{updated_at:string;units:{air_temperature:string;air_temperature_max?:string}};timeseries:{time:string;data:{instant:{details:{air_temperature?:number}};next_6_hours?:{details:{air_temperature_max?:number}}}}[]}};
/** Lower bounds from instantaneous / fully contained six-hour maxima. Crossing-midnight
 * intervals cannot be assigned to either calendar day. Partial days never imply an all-clear. */
export function parseMetHeat(raw:MetHeat,history:Weather[],now=Date.now()):HeatForecast{
 const meta=raw?.properties?.meta,rows=raw?.properties?.timeseries;
 if(meta?.units?.air_temperature!=='celsius'||!Array.isArray(rows)||!Number.isFinite(Date.parse(meta.updated_at))||now-Date.parse(meta.updated_at)>12*3600000||Date.parse(meta.updated_at)>now)throw Error('Invalid MET Norway heat forecast');
 const today=localDate(now),days:HeatDay[]=Array.from({length:10},(_,i)=>({date:new Date((dayNumber(today)+i-3)*86400000).toISOString().slice(0,10),maximumC:null,kind:i<3?'observed-samples':i===3?'observations-and-forecast':'forecast',complete:false}));
 const byDate=new Map(days.map(d=>[d.date,d]));
 const add=(time:number,value:unknown)=>{const d=byDate.get(localDate(time));if(d&&typeof value==='number'&&Number.isFinite(value)&&value>=-60&&value<=60)d.maximumC=Math.max(d.maximumC??-Infinity,value);};
 for(const w of history){const t=Date.parse(w.time);if(t<=now)add(t-w.stepHours*3600000,w.temperature);}
 for(const row of rows){const time=Date.parse(row.time);if(!Number.isFinite(time)||time<now)continue;add(time,row.data?.instant?.details?.air_temperature);if(meta.units.air_temperature_max==='celsius'&&localDate(time)===localDate(time+6*3600000-1))add(time,row.data.next_6_hours?.details.air_temperature_max);}
 if(!days.some(d=>d.kind==='forecast'&&d.maximumC!==null))throw Error('Empty MET Norway heat forecast');
 return {days,retrievedAt:new Date(now).toISOString(),status:'live',source:'MET Norway + XEMA samples',detail:'Open-Meteo unavailable. Forecast peaks use MET Norway instantaneous and same-day six-hour maxima; observed history uses XEMA temperature samples. Partial daily coverage gives lower bounds, not exact daily maxima. Threshold exceedances can trigger review; missing peaks cannot rule out a heatwave.'};
}
let blockedUntil=0;
export async function loadHeatForecast(station:Station,now=Date.now(),history:Weather[]=[]):Promise<HeatForecast>{
 try{return await diskCache(`heat-daily-v3:${station.id}:${localDate(now)}`,3600000,async()=>{
  const url='https://api.open-meteo.com/v1/forecast?'+new URLSearchParams({latitude:String(station.center[1]),longitude:String(station.center[0]),daily:'temperature_2m_max',past_days:'3',forecast_days:'7',timezone:'Europe/Madrid',temperature_unit:'celsius'});
  if(Date.now()>=blockedUntil)try{return parseHeatForecast(await fetchJSON(url,{},20000),now);}catch(error){if(error instanceof Error&&error.message==='Upstream HTTP 429')blockedUntil=Date.now()+6*3600000;}
  const raw=await fetchJSON<MetHeat>(`https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${station.center[1].toFixed(4)}&lon=${station.center[0].toFixed(4)}`,{headers:{'User-Agent':'GINGER/1.0 Barcelona fire-receptivity research (local application)'}},25000);
  return parseMetHeat(raw,history,now);
 });}catch{return {days:[],retrievedAt:new Date(now).toISOString(),status:'unavailable'};}
}
