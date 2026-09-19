import 'server-only';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

export const WEATHER_NEXT_COLLECTION = 'projects/gcp-public-data-weathernext/assets/weathernext_3_0_0_0p1deg';
const CATALOG = 'https://developers.google.com/earth-engine/datasets/catalog/projects_gcp-public-data-weathernext_assets_weathernext_3_0_0_0p1deg';
const STATS = ['mean', 'p10', 'p25', 'p50', 'p75', 'p90'] as const;
const FIELDS = {
 temperature2m: ['temperature_2m','K','degC',-120,70],
 dewpoint2m: ['dewpoint_temperature_2m','K','degC',-150,70],
 windSpeed10m: ['wind_speed_10m','m/s','km/h',0,500],
 windU10m: ['u_component_of_wind_10m','m/s','m/s',-150,150],
 windV10m: ['v_component_of_wind_10m','m/s','m/s',-150,150],
 precipitation1h: ['total_precipitation_1hr','m','mm',0,1000],
} as const;
type VariableName = keyof typeof FIELDS;
type Statistic = typeof STATS[number];
export type WeatherNextVariable = {unit:string;sourceUnit:string;statistics:Record<Statistic,number>;bands:Record<Statistic,string>};
export type WeatherNextForecast = {issuedAt:string;validAt:string;forecastHour:number;complete:true;variables:Record<VariableName,WeatherNextVariable>};
export type WeatherNextExport = {schemaVersion:1;status:'live';source:{provider:string;collection:string;catalog:string;gridResolutionDegrees:number;sampleScaleMeters:number;actualBands:string[]};retrievedAt:string;issuedAt:string;requestedValidAt:string;location:{latitude:number;longitude:number};forecasts:WeatherNextForecast[];limitations:string[]};
export type WeatherNextResult = {status:'live'|'stale'|'unavailable';detail:string;retrievedAt:string;data:WeatherNextExport|null};
function record(x:unknown):Record<string,unknown>{if(!x||typeof x!=='object'||Array.isArray(x))throw Error('Invalid object');return x as Record<string,unknown>;}
function timestamp(x:unknown):number {if(typeof x!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(x)||!Number.isFinite(Date.parse(x)))throw Error('Invalid timestamp');return Date.parse(x);}
function number(x:unknown,min:number,max:number):number {if(typeof x!=='number'||!Number.isFinite(x)||x<min||x>max)throw Error('Invalid numeric value');return x;}

/** Strict boundary for the authenticated exporter. Never supplies replacement weather. */
export function parseWeatherNextExport(raw:unknown):WeatherNextExport {
 const x=record(raw);if(x.schemaVersion!==1||x.status!=='live')throw Error('Only complete live exports are accepted');
 const issued=timestamp(x.issuedAt),retrieved=timestamp(x.retrievedAt),requested=timestamp(x.requestedValidAt);
 if(issued>retrieved+300000)throw Error('Initialization is later than retrieval');
 const source=record(x.source);if(source.collection!==WEATHER_NEXT_COLLECTION||source.catalog!==CATALOG||source.provider!=='Google DeepMind WeatherNext 3'||source.gridResolutionDegrees!==.1||source.sampleScaleMeters!==10000)throw Error('Unexpected source');
 if(!Array.isArray(source.actualBands)||!source.actualBands.every(b=>typeof b==='string')||source.actualBands.length>500)throw Error('Invalid band inventory');
 const location=record(x.location);number(location.latitude,-90,90);number(location.longitude,-180,180);
 if(!Array.isArray(x.forecasts)||!x.forecasts.length||x.forecasts.length>48)throw Error('Invalid forecast length');
 let previous=-Infinity;
 for(const row of x.forecasts){const f=record(row),valid=timestamp(f.validAt);if(timestamp(f.issuedAt)!==issued||f.complete!==true)throw Error('Mixed initialization or incomplete sample');
 const lead=number(f.forecastHour,1,360);if(!Number.isInteger(lead)||valid!==issued+lead*3600000||valid<requested||valid<=previous)throw Error('Invalid forecast chronology');previous=valid;
 const variables=record(f.variables);
 for(const [key,[base,original,unit,min,max]] of Object.entries(FIELDS)){
  const v=record(variables[key]);if(v.unit!==unit||v.sourceUnit!==original)throw Error('Unexpected units');
  const values=record(v.statistics),bands=record(v.bands);
  for(const stat of STATS){number(values[stat],min,max);if(bands[stat]!==`${base}_${stat}`||!source.actualBands.includes(bands[stat]))throw Error('Band provenance mismatch');}
  const q=STATS.slice(1).map(stat=>values[stat] as number);if(q.some((n,i)=>i>0&&n<q[i-1]))throw Error('Non-monotonic quantiles');
 }
 }
 if(!Array.isArray(x.limitations)||!x.limitations.every(s=>typeof s==='string'&&s.length<2000)||x.limitations.length>20)throw Error('Invalid limitations');
 // Return only the known contract, never arbitrary file properties to the browser.
 return {schemaVersion:1,status:'live',source:{provider:source.provider,collection:WEATHER_NEXT_COLLECTION,catalog:CATALOG,gridResolutionDegrees:.1,sampleScaleMeters:10000,actualBands:source.actualBands as string[]},retrievedAt:x.retrievedAt as string,issuedAt:x.issuedAt as string,requestedValidAt:x.requestedValidAt as string,location:{latitude:location.latitude as number,longitude:location.longitude as number},forecasts:x.forecasts.map(row=>{const f=record(row),vs=record(f.variables);return{issuedAt:f.issuedAt as string,validAt:f.validAt as string,forecastHour:f.forecastHour as number,complete:true,variables:Object.fromEntries(Object.keys(FIELDS).map(key=>{const v=record(vs[key]);return[key,{unit:v.unit,sourceUnit:v.sourceUnit,statistics:Object.fromEntries(STATS.map(s=>[s,record(v.statistics)[s]])),bands:Object.fromEntries(STATS.map(s=>[s,record(v.bands)[s]]))}];})) as Record<VariableName,WeatherNextVariable>};}),limitations:x.limitations as string[]};
}

export async function readWeatherNextExport(lat:number,lon:number,now=Date.now()):Promise<WeatherNextResult> {
 const checkedAt=new Date(now).toISOString();
 const fail=(detail:string,status:'stale'|'unavailable'='unavailable',retrievedAt=checkedAt):WeatherNextResult=>({status,detail,retrievedAt,data:null});
 const file=process.env.WEATHERNEXT_NORMALIZED_FILE?.trim();
 if(!file)return fail('WeatherNext export not configured; authenticated allowlist access is required.');
 if(!isAbsolute(file))return fail('WeatherNext export path must be absolute.');
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return fail('Invalid requested location.');
 try {
  const handle=await open(file,'r');let content:string;
  try{const stat=await handle.stat();if(!stat.isFile()||stat.size>2*1024*1024)throw Error('Invalid export file');const buffer=Buffer.alloc(2*1024*1024+1);const {bytesRead}=await handle.read(buffer,0,buffer.length,0);if(bytesRead>2*1024*1024)throw Error('Export too large');content=buffer.subarray(0,bytesRead).toString('utf8');}finally{await handle.close();}
  const data=parseWeatherNextExport(JSON.parse(content));
  if(Math.abs(data.location.latitude-lat)>.001||Math.abs(data.location.longitude-lon)>.001)return fail('Configured WeatherNext point does not match this location; request a new point export.');
  const issued=Date.parse(data.issuedAt),retrieved=Date.parse(data.retrievedAt);
  if(issued>now+300000||retrieved>now+300000)return fail('WeatherNext export contains a future initialization or retrieval time.');
  if(now-issued>12*3600000||now-retrieved>2*3600000)return fail('WeatherNext export stale: initialization older than 12 hours or retrieval older than 2 hours.','stale',data.retrievedAt);
  if(!data.forecasts.some(f=>Date.parse(f.validAt)>=now&&Date.parse(f.validAt)<=now+3600000))return fail('WeatherNext export has no forecast valid within the next hour.','stale',data.retrievedAt);
  return {status:'live',detail:'Authenticated export provenance supplied by operator; experimental 0.1° ensemble forecast, separate from current weather. Local ingestion does not independently verify upstream authentication.',retrievedAt:data.retrievedAt,data};
 }catch{return fail('WeatherNext export unavailable or rejected: invalid schema, units, bands, chronology or incomplete samples.');}
}
