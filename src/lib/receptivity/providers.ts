import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {fetchJSON} from '../providers/http';
import type {Station,Weather,History,Official,SourceStatus} from './types';
export const DATA_DIR=process.env.GINGER_RECEPTIVITY_DIR||join(process.cwd(),'.ginger-data/receptivity');
const HOUR=3600000;
const SOCRATA='https://analisi.transparenciacatalunya.cat/resource/';
export const ALFA_URL='https://services7.arcgis.com/ZCqVt1fRXwwK6GF4/arcgis/rest/services/Pla_Alfa_Municipal_Avui_FL_2_view/FeatureServer/0';
const inFlight=new Map<string,Promise<unknown>>();
export async function atomicJSON(file:string,value:unknown){await mkdir(DATA_DIR,{recursive:true});const temp=file+`.${process.pid}.tmp`;await writeFile(temp,JSON.stringify(value));await rename(temp,file);}
/** Persistent bounded-by-provider/key cache. Never converts failed requests to successful data. */
async function diskCache<T>(key:string,ttl:number,load:()=>Promise<T>):Promise<T>{
 const file=join(DATA_DIR,createHash('sha256').update(key).digest('hex')+'.json');
 try{const old=JSON.parse(await readFile(file,'utf8'));if(Date.now()-old.at<ttl)return old.value as T;}catch{}
 if(inFlight.has(key))return inFlight.get(key) as Promise<T>;
 const work=load().then(async value=>{await atomicJSON(file,{at:Date.now(),value});return value;}).finally(()=>inFlight.delete(key));inFlight.set(key,work);return work;
}
export async function concurrent<T,R>(items:T[],fn:(item:T)=>Promise<R>,limit=3){const out:R[]=[];let cursor=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(cursor<items.length){const index=cursor++;out[index]=await fn(items[index]);}}));return out;}
function soda(dataset:string,params:Record<string,string>){return SOCRATA+dataset+'.json?'+new URLSearchParams(params);}
function num(v:unknown):number|undefined {if(v===null||v===undefined||v==='')return;const n=Number(v);return Number.isFinite(n)?n:undefined;}
export async function loadStations():Promise<Station[]>{return diskCache('xema-stations-barcelona-v1',86400000,async()=>{
 const raw=await fetchJSON<Record<string,string>[]>(soda('yqwd-vj5e',{'$where':"latitud between '41.2' and '41.7' AND longitud between '1.7' and '2.5' AND nom_estat_ema='Operativa'",'$limit':'200'}),{},25000);
 if(!Array.isArray(raw)||!raw.length)throw Error('XEMA station metadata unavailable');
 return raw.map(s=>({id:s.codi_estacio,name:s.nom_estacio,center:[Number(s.longitud),Number(s.latitud)] as [number,number],elevation:Number(s.altitud)})).filter(s=>s.id&&s.name&&s.center.every(Number.isFinite)&&Number.isFinite(s.elevation));
 });}
export type XemaRow={id:string;codi_variable:string;data_lectura:string;valor_lectura?:string;codi_base:string;estat?:string;estat_lectura?:string};
export function xemaPeriods(rows:XemaRow[],now:number){
 const periods=new Map<number,{values:Record<string,number>;step:number}>();
 for(const row of rows){const v=num(row.valor_lectura);const step=row.codi_base==='SH'?.5:row.codi_base==='HO'?1:null;if(v===undefined||step===null)continue;
  const flag=row.estat??row.estat_lectura;if(flag&& !['V','T'].includes(flag))continue;
  // XEMA labels beginning of recording interval (extrema timestamps can occur later).
  const time=Date.parse(row.data_lectura.endsWith('Z')?row.data_lectura:row.data_lectura+'Z')+step*HOUR;
  if(!Number.isFinite(time)||time>now)continue;
  const p=periods.get(time)||{values:{},step};p.values[row.codi_variable]=v;periods.set(time,p);
 }
 return [...periods].sort((a,b)=>a[0]-b[0]);
}
export function parseXema(rows:XemaRow[],now:number):{weather:Weather[];history:History}{
 const periods=xemaPeriods(rows,now);const weather:Weather[]=[];
 for(const [time,{values:v,step}] of periods){
  const [t,rh,wind,rain]=[v['32'],v['33'],v['30'],v['35']];
  if(![t,rh,wind,rain].every(Number.isFinite)||t< -60||t>60||rh<0||rh>100||wind<0||wind>70||rain<0||rain>500)continue;
  const dew=243.04*(Math.log(Math.max(.01,rh)/100)+17.625*t/(243.04+t))/(17.625-Math.log(Math.max(.01,rh)/100)-17.625*t/(243.04+t));
  weather.push({time:new Date(time).toISOString(),temperature:t,relativeHumidity:rh,windSpeed:wind*3.6,precipitation:rain,stepHours:step,windDirection:v['31'],windGust:v['50']===undefined?undefined:v['50']*3.6,solarRadiation:v['36'],dewPoint:Math.round(dew*10)/10,vpd:Math.round(.6108*Math.exp(17.27*t/(t+237.3))*(1-rh/100)*100)/100,source:'Meteocat XEMA · station observation (validation flag unavailable where omitted)'});
 }
 const latest=weather.at(-1);const history:History={continuousHours:0};if(!latest)return {weather,history};const end=Date.parse(latest.time);
 const subset=(hours:number)=>periods.filter(([t])=>t>end-hours*HOUR&&t<=end);
 for(const [key,hours] of Object.entries({rain1h:1,rain24h:24,rain3d:72,rain7d:168,rain30d:720})){
  const p=subset(hours),valid=p.filter(([,v])=>v.values['35']!==undefined&&v.values['35']>=0);
  const coverage=valid.reduce((sum,[,v])=>sum+v.step,0);
  if(Math.abs(coverage-hours)<.01)Object.assign(history,{[key]:Number(valid.reduce((sum,[,v])=>sum+v.values['35'],0).toFixed(2))});
 }
 for(const [variable,meanKey,minKey] of [['33','humidityMean24h','humidityMin24h'],['32','temperatureMean24h','']] as const){const p=subset(24).filter(([,v])=>v.values[variable]!==undefined);const hours=p.reduce((s,[,v])=>s+v.step,0);if(hours>=23.99){Object.assign(history,{[meanKey]:Number((p.reduce((s,[,v])=>s+v.values[variable]*v.step,0)/hours).toFixed(1))});if(minKey)Object.assign(history,{[minKey]:Math.min(...p.map(([,v])=>v.values[variable]))});}}
 let expected=end;for(let i=weather.length-1;i>=0;i--){const w=weather[i];if(Math.abs(Date.parse(w.time)-expected)>1000)break;history.continuousHours+=w.stepHours;expected-=w.stepHours*HOUR;}
 return {weather,history};
}
export async function loadXema(station:Station,now:number){
 return diskCache(`xema-history-30d-v2:${station.id}`,25*60000,async()=>{
  const archive=join(DATA_DIR,`xema-raw-${station.id}.json`);
  let saved:XemaRow[]=[];try{saved=JSON.parse(await readFile(archive,'utf8'));}catch{}
  const cutoff=now-31*86400000;
  const latest=saved.at(-1)?.data_lectura;const lastTime=latest?Date.parse(latest.endsWith('Z')?latest:latest+'Z'):NaN;
  const from=new Date(Number.isFinite(lastTime)?Math.max(cutoff,lastTime-2*HOUR):cutoff).toISOString().slice(0,19);
  const fresh=await fetchJSON<XemaRow[]>(soda('nzvn-apee',{'$where':`codi_estacio='${station.id}' AND data_lectura >= '${from}' AND codi_variable in ('30','31','32','33','35','36','50')`,'$order':'data_lectura ASC,codi_variable ASC','$limit':'15000'}),{},60000);
  if(!Array.isArray(fresh)||fresh.length>=15000)throw Error('Incomplete or truncated XEMA history');
  const rows=[...new Map([...saved,...fresh].map(r=>[r.id,r])).values()].filter(r=>Date.parse(r.data_lectura.endsWith('Z')?r.data_lectura:r.data_lectura+'Z')>=cutoff).sort((a,b)=>a.data_lectura.localeCompare(b.data_lectura)||a.codi_variable.localeCompare(b.codi_variable));
  await atomicJSON(archive,rows);
  return parseXema(rows,now);
 });
}
export type Forecast={weather:Weather[];source:string;issuedAt:string;detail:string};
let openMeteoBlockedUntil=0;
export async function loadForecast(station:Station,now:number):Promise<Forecast>{return diskCache(`forecast-v2:${station.id}`,60*60000,async()=>{
 let failure='';
 if(Date.now()>=openMeteoBlockedUntil){try{
  const url='https://api.open-meteo.com/v1/forecast?'+new URLSearchParams({latitude:String(station.center[1]),longitude:String(station.center[0]),hourly:'temperature_2m,relative_humidity_2m,dew_point_2m,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m,vapour_pressure_deficit,et0_fao_evapotranspiration,soil_moisture_0_to_1cm',forecast_days:'3',timezone:'UTC'});
  const r=await fetch(url,{signal:AbortSignal.timeout(15000),cache:'no-store'});if(!r.ok){if(r.status===429)openMeteoBlockedUntil=Date.now()+6*HOUR;throw Error(`HTTP ${r.status}`);}
  const d=await r.json();const h=d.hourly,u=d.hourly_units;
  if(!h||!Array.isArray(h.time)||u?.wind_speed_10m!=='km/h'||u?.precipitation!=='mm'||u?.temperature_2m!=='°C'||u?.relative_humidity_2m!=='%')throw Error('Weather schema/units changed');
  const weather:Weather[]=h.time.map((t:string,i:number)=>({time:t+'Z',temperature:h.temperature_2m[i],relativeHumidity:h.relative_humidity_2m[i],windSpeed:h.wind_speed_10m[i],windGust:h.wind_gusts_10m[i]??undefined,windDirection:h.wind_direction_10m[i]??undefined,precipitation:h.precipitation[i],stepHours:1,dewPoint:h.dew_point_2m[i]??undefined,vpd:h.vapour_pressure_deficit[i]??undefined,et0:h.et0_fao_evapotranspiration[i]??undefined,soilMoisture:h.soil_moisture_0_to_1cm[i]??undefined,source:'Open-Meteo · model forecast'})).filter((w:Weather)=>[w.temperature,w.relativeHumidity,w.windSpeed,w.precipitation].every(v=>typeof v==='number'&&Number.isFinite(v)));
  return {weather,source:'Open-Meteo',issuedAt:new Date(now).toISOString(),detail:'Hourly model forecast. Provider run issue time is not exposed; timestamp is retrieval time.'};
 }catch(e){failure=`Open-Meteo unavailable (${e instanceof Error?e.message:'network failure'}). `;}}
 else failure='Open-Meteo rate-limited; six-hour cooldown. ';
 const url=`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${station.center[1].toFixed(4)}&lon=${station.center[0].toFixed(4)}`;
 type MetStep={time:string;data:{instant:{details:Record<string,number>};next_1_hours?:{details:{precipitation_amount?:number}}}};
 const d=await fetchJSON<{properties:{meta:{updated_at:string;units:Record<string,string>};timeseries:MetStep[]}}>(url,{headers:{'User-Agent':'GINGER/1.0 Barcelona fire-receptivity research (local application)'}},25000);
 if(d.properties?.meta.units.wind_speed!=='m/s'||d.properties.meta.units.air_temperature!=='celsius'||d.properties.meta.units.precipitation_amount!=='mm')throw Error('MET Norway units changed');
 const weather:Weather[]=[];const times=d.properties.timeseries;
 // Precipitation is NEXT hour, so assign it to the following endpoint. Do not shift it twice.
 for(let i=1;i<times.length;i++){const p=times[i-1],s=times[i],v=s.data.instant.details,rain=p.data.next_1_hours?.details.precipitation_amount;
  if(Date.parse(s.time)-Date.parse(p.time)!==HOUR||rain===undefined||![v.air_temperature,v.relative_humidity,v.wind_speed,rain].every(Number.isFinite))continue;
  weather.push({time:s.time,temperature:v.air_temperature,relativeHumidity:v.relative_humidity,windSpeed:v.wind_speed*3.6,windDirection:v.wind_from_direction,windGust:v.wind_speed_of_gust===undefined?undefined:v.wind_speed_of_gust*3.6,precipitation:rain,stepHours:1,source:'MET Norway Locationforecast · model forecast'});
 }
 if(!weather.length||now-Date.parse(d.properties.meta.updated_at)>12*HOUR)throw Error('MET Norway forecast is stale or empty');
 return {weather,source:'MET Norway',issuedAt:d.properties.meta.updated_at,detail:failure+'MET Norway hourly model forecast; precipitation aligned to the end of its accumulation interval.'};
 });}
export async function loadOfficial():Promise<Official>{
 const url='https://interior.gencat.cat/ca/serveis/informacio-geografica/visors-i-aplicacions/pla-alfa/';
 try{return await diskCache('official-alfa-v1',30*60000,async()=>{
 const meta=await fetchJSON<{editingInfo?:{lastEditDate:number}}>(ALFA_URL+'?f=json',{},20000);
 const params=new URLSearchParams({where:'1=1',geometry:'1.82,41.27,2.40,41.62',geometryType:'esriGeometryEnvelope',inSR:'4326',spatialRel:'esriSpatialRelIntersects',outFields:'CODIMUNI,NOMMUNI,PERIL_M',outSR:'4326',returnGeometry:'true',geometryPrecision:'5',maxAllowableOffset:'0.0001',f:'geojson'});
 const features=await fetchJSON<Official['features']>(ALFA_URL+'/query?'+params,{},25000);
 if(features.type!=='FeatureCollection'||!features.features.length)throw Error('Official geometry unavailable');
 const updated=meta.editingInfo?.lastEditDate;const fresh=typeof updated==='number'&&Date.now()-updated<30*HOUR&&updated<=Date.now()+5*60000;
 const status:SourceStatus={id:'official',name:'Generalitat · Pla Alfa',status:fresh?'live':'stale',url,detail:fresh?'Municipal operational restriction levels; not equivalent to receptivity.':'Public official layer is accessible, but its published edit date is older than 30 hours. Levels are withheld from current comparison; municipal boundaries/names remain usable.',retrievedAt:new Date().toISOString(),validAt:updated?new Date(updated).toISOString():undefined,refreshMinutes:30};
 return {status,features,comparable:fresh};
 });}catch(e){return {status:{id:'official',name:'Generalitat · Pla Alfa',status:'unavailable',url,detail:e instanceof Error?e.message:'Official feed unavailable'},features:{type:'FeatureCollection',features:[]},comparable:false};}
}
