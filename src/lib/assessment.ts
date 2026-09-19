import {estimateVegetationDryness,extremeDrynessHours,type VegetationDryness} from './vegetation-dryness';
import {readExposure} from './exposure/store';
import {exposureReason} from './exposure/model';
import type {ExposureSummary} from './exposure/types';
import {backendSnapshot} from './backend-snapshots';
import {readPlanningContext,type PlanningContext} from './providers/catalonia';
import type {Feature,FeatureCollection,Geometry} from 'geojson';
import {parseBuildingFootprints} from './sage/building-inventory';
import {cached,fetchJSON,isoNow} from './providers/http';
import {readDeepfireContext,type DeepfireContext} from './providers/deepfire-context';
import {satelliteBounds} from './providers/satellite';
import {locationHotspots} from './providers/satellite';
import type {Hotspot} from './providers/types';
import {distanceKm} from './simulation';
import {readWeatherNextExport,type WeatherNextResult} from './providers/weathernext';

export type WeatherHour={time:string;temperatureC:number;humidityPct:number;windKmh:number;windFromDegrees:number;precipitationMm:number};
export type Evidence={observedAt?:string;coverage?:string;source:string;status:'live'|'unavailable'|'stale';retrievedAt:string;detail:string};
export type Assessment={vegetationDryness?:VegetationDryness;exposure?:ExposureSummary;planningContext?:PlanningContext;deepfire?:DeepfireContext;weatherNext?:WeatherNextResult;location:{lat:number;lon:number;radiusM:number};generatedAt:string;sources:Evidence[];weather:{history?:WeatherHour[];current:WeatherHour|null;outlook:WeatherHour[];past72hPrecipitationMm:number|null;elevationM:number|null};geography:{buildings:FeatureCollection;landcover:FeatureCollection;roads:FeatureCollection;assets:FeatureCollection};satellite:{hotspots:Hotspot[];frpTrend:{time:string;mw:number}[];escalation:null|{ratio:number;minutes:number}};sage:{state:'monitoring'|'review'|'escalating';reasons:string[];ruleVersion:string};completeness:{available:string[];missing:string[]};forecast:{available:false;reason:string};units:{temperature:string;wind:string;direction:string;precipitation:string;elevation:string;frp:string}};
const empty=():FeatureCollection=>({type:'FeatureCollection',features:[]});
export function validateLocation(lat:number,lon:number){if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)throw Error('Latitude must be −90…90 and longitude −180…180.');}
type WeatherResponse={elevation?:number;hourly?:Record<string,unknown>;hourly_units?:Record<string,string>};
export function parseWeather(raw:WeatherResponse,now=Date.now()):Assessment['weather']{
 const expectedUnits:Record<string,string>={temperature_2m:'°C',relative_humidity_2m:'%',wind_speed_10m:'km/h',wind_direction_10m:'°',precipitation:'mm'};if(!raw.hourly_units||Object.entries(expectedUnits).some(([k,v])=>raw.hourly_units![k]!==v))throw Error('Unexpected weather units');
 const h=raw.hourly;if(!h||!Array.isArray(h.time))throw Error('Weather hourly data unavailable');
 const keys=['temperature_2m','relative_humidity_2m','wind_speed_10m','wind_direction_10m','precipitation'];
 if(!keys.every(k=>Array.isArray(h[k])&&(h[k] as unknown[]).length===(h.time as unknown[]).length))throw Error('Weather arrays are incomplete');
 const hours=(h.time as unknown[]).flatMap((time,i)=>{const values=keys.map(k=>(h[k] as unknown[])[i]);if(typeof time!=='string'||!values.every(v=>typeof v==='number'&&Number.isFinite(v)))return[];const [temperatureC,humidityPct,windKmh,windFromDegrees,precipitationMm]=values as number[];const utc=time.endsWith('Z')?time:`${time}Z`;if(!/^\d{4}-\d{2}-\d{2}T\d{2}:00(:00)?Z$/.test(utc)||!Number.isFinite(Date.parse(utc))||new Date(utc).toISOString().slice(0,16)!==utc.slice(0,16)||humidityPct<0||humidityPct>100||windKmh<0||windFromDegrees<0||windFromDegrees>360||precipitationMm<0)return[];return[{time:utc,temperatureC,humidityPct,windKmh,windFromDegrees,precipitationMm}];});
 const start=Math.floor(now/3600000)*3600000;const outlook=hours.filter(h=>Date.parse(h.time)>=start&&Date.parse(h.time)<start+24*3600000);const past=hours.filter(h=>Date.parse(h.time)>start-72*3600000&&Date.parse(h.time)<=start);
 if(outlook.length!==24||outlook.some((h,i)=>Date.parse(h.time)!==start+i*3600000))throw Error('Incomplete or non-contiguous 24-hour weather forecast');
 return{history:past,current:outlook[0],outlook,past72hPrecipitationMm:past.length===72&&past.every((h,i)=>Date.parse(h.time)===start-(71-i)*3600000)?Math.round(past.reduce((s,h)=>s+h.precipitationMm,0)*10)/10:null,elevationM:Number.isFinite(raw.elevation)?raw.elevation!:null};
}
export async function readLocationWeather(lat:number,lon:number){validateLocation(lat,lon);const result=await cached(`assessment-weather:${lat}:${lon}`,600000,async()=>{const url=new URL('https://api.open-meteo.com/v1/forecast');url.search=new URLSearchParams({latitude:String(lat),longitude:String(lon),hourly:'temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation',past_days:'3',forecast_days:'2',timezone:'UTC',wind_speed_unit:'kmh',temperature_unit:'celsius',precipitation_unit:'mm'}).toString();return{raw:await fetchJSON<WeatherResponse>(url.href,{},10000),retrievedAt:isoNow()};});return{data:parseWeather(result.raw),retrievedAt:result.retrievedAt};}
type OSMElement={type:string;id:number;lat?:number;lon?:number;center?:{lat:number;lon:number};geometry?:{lat:number;lon:number}[];tags?:Record<string,string>};
export function parseGeography(elements:OSMElement[]):Assessment['geography']{
 const result={buildings:parseBuildingFootprints(elements),landcover:empty(),roads:empty(),assets:empty()};
 for(const e of elements){const tags=e.tags||{};const validPoint=(p:{lon:number;lat:number})=>Number.isFinite(p.lon)&&Number.isFinite(p.lat)&&Math.abs(p.lon)<=180&&Math.abs(p.lat)<=90;const coords=e.geometry?.every(validPoint)?e.geometry.map(p=>[p.lon,p.lat]):undefined;const closed=coords&&coords.length>=4&&coords[0][0]===coords.at(-1)![0]&&coords[0][1]===coords.at(-1)![1];const p=e.center||(Number.isFinite(e.lat)&&Number.isFinite(e.lon)?{lat:e.lat!,lon:e.lon!}:undefined);const point=p&&validPoint(p)?[p.lon,p.lat]:coords?.[0];
 const properties:Record<string,unknown>={id:`${e.type}/${e.id}`,name:tags.name||tags.amenity||tags.building||tags.landuse||tags.natural||tags.highway||'Mapped feature',source:'OpenStreetMap',tags,natural:tags.natural,landuse:tags.landuse};
 const feature=(geometry:Geometry):Feature=>({type:'Feature',geometry,properties});

 if((tags.landuse||tags.natural)&&closed)result.landcover.features.push(feature({type:'Polygon',coordinates:[coords!]}));
 if(tags.highway&&coords&&coords.length>=2){properties.capacity=null;properties.closureStatus='unknown';result.roads.features.push(feature({type:'LineString',coordinates:coords}));}
 if((tags.amenity||tags.power||tags.emergency)&&point){properties.population=null;properties.capacity=null;result.assets.features.push(feature({type:'Point',coordinates:point}));}
 }return result;
}
// Public instances listed by https://wiki.openstreetmap.org/wiki/Overpass_API .
async function geography(lat:number,lon:number){return cached(`assessment-osm-v2:${lat}:${lon}`,86400000,async()=>{
 const around=`around:1500,${lat},${lon}`;
 const query=`[out:json][timeout:10];(way[building](${around});relation[type=multipolygon][building](${around});way[landuse](${around});way[natural](${around});way[highway](${around});nwr[amenity~"school|hospital|nursing_home|fire_station|police"](${around});nwr[power=substation](${around}););out center geom 1800;`;
 for(const endpoint of ['https://overpass-api.de/api/interpreter','https://overpass.private.coffee/api/interpreter']){
  try{
   const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'GINGER-Wildfire-Prototype/0.1 (bounded geographic assessment; local research)'},body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(12000),cache:'no-store'});
   if(!response.ok)continue;
   const r=await response.json() as {elements:OSMElement[];remark?:string};
   if(!Array.isArray(r.elements)||r.remark)continue;
   return{data:parseGeography(r.elements),retrievedAt:isoNow(),truncated:r.elements.length>=1800};
  }catch{/* Try the documented alternate instance once; no synthetic inventory. */}
 }
 throw Error('Both public Overpass instances unavailable or incomplete');
});}
/** Comparison is intentionally withheld without matched coverage/incident identity. A mixed 10 km sample is not an FRP time series. */
async function loadAssessment(lat:number,lon:number):Promise<Assessment>{
 validateLocation(lat,lon);lat=Number(lat.toFixed(5));lon=Number(lon.toFixed(5));
 const planningPromise=readPlanningContext(lat,lon);
 const deepfirePromise=readDeepfireContext(satelliteBounds(lat,lon,10));
 const weatherNextPromise=process.env.WEATHERNEXT_NORMALIZED_FILE?.trim()?readWeatherNextExport(lat,lon):Promise.resolve(undefined);
 const now=isoNow();const results=await Promise.allSettled([readLocationWeather(lat,lon),geography(lat,lon),locationHotspots(lat,lon)]);const w=results[0],g=results[1],s=results[2];
 const weatherData=w.status==='fulfilled'?w.value.data:{history:[],current:null,outlook:[],past72hPrecipitationMm:null,elevationM:null};const geo=g.status==='fulfilled'?g.value.data:{buildings:empty(),landcover:empty(),roads:empty(),assets:empty()};
 const hotspots=s.status==='fulfilled'?s.value.data.filter(h=>distanceKm([lon,lat],h.position)<=10):[];
 const vegetationDryness=estimateVegetationDryness(weatherData.history,weatherData.outlook);
 const dryHours=extremeDrynessHours(vegetationDryness);
 const reasons:string[]=[];if(dryHours.length)reasons.push(`${dryHours.length} forecast hours have estimated extremely dry dead fine fuels (below 6% moisture). Inspect local fuels; this is not measured live vegetation moisture.`);
 const adverse=weatherData.outlook.filter(h=>h.humidityPct<=25&&h.windKmh>=25&&h.temperatureC>=28);if(adverse.length)reasons.push(`${adverse.length} forecast hours meet review thresholds: temperature ≥28°C, humidity ≤25%, wind ≥25 km/h.`);
 const recent=s.status==='fulfilled'&&s.value.status==='live'?hotspots.filter(h=>Date.now()-Date.parse(h.provenance.observedAt)>=0&&Date.now()-Date.parse(h.provenance.observedAt)<6*3600000):[];if(recent.length)reasons.push(`${recent.length} thermal detections within 10 km in the past 6 hours; wildfire confirmation required.`);
 if(w.status==='rejected')reasons.push('Weather unavailable: severity cannot be fully assessed.');if(g.status==='rejected')reasons.push('Local geographic inventory unavailable.');if(s.status==='rejected')reasons.push('Satellite feed unavailable.');if(s.status==='fulfilled'&&s.value.status==='stale')reasons.push('Satellite feed stale: new detection assessment requires a fresh acquisition.');
 if(!reasons.length)reasons.push('No configured escalation heuristic is currently met. This does not establish absence of fire risk.');
 const sources:Evidence[]=[{source:'Open-Meteo',status:w.status==='fulfilled'?'live':'unavailable',retrievedAt:w.status==='fulfilled'?w.value.retrievedAt:now,detail:'Modelled hourly weather, UTC valid times; past precipitation is model-derived, not a station measurement.'},{source:'OpenStreetMap / Overpass',status:g.status==='fulfilled'?'live':'unavailable',retrievedAt:g.status==='fulfilled'?g.value.retrievedAt:now,detail:`1500 m query; community inventory, unknown completeness/capacity. ${g.status==='fulfilled'&&g.value.truncated?'Result limit reached; incomplete inventory. ':''}Building ways and multipolygon relations include courtyard holes. The simulation loads its own dedicated building inventory. © OpenStreetMap contributors / ODbL.`},{source:s.status==='fulfilled'?s.value.source:'Satellite detections',status:s.status==='fulfilled'&&s.value.status==='live'?'live':s.status==='fulfilled'&&s.value.status==='stale'?'stale':'unavailable',retrievedAt:s.status==='fulfilled'?s.value.updatedAt:now,detail:'Thermal detections do not establish wildfire perimeter. FRP comparison withheld: incident identity and comparable coverage not established.'}];
 const satelliteCovered=s.status==='fulfilled'&&s.value.covered;if(!satelliteCovered){sources[2].status='unavailable';reasons.push('Satellite coverage unavailable at this location.');}
 const deepfire=await deepfirePromise;
 sources.push(...deepfire.sources);
 const weatherNext=await weatherNextPromise;
 if(weatherNext)sources.push({source:'Google DeepMind WeatherNext 3',status:weatherNext.status,retrievedAt:weatherNext.retrievedAt,detail:weatherNext.detail,coverage:'Configured point export; independent from Open-Meteo forecast'});
 sources[0].coverage='Model grid at requested coordinates; 24 hourly valid times';sources[0].observedAt=weatherData.current?.time;
 sources[1].coverage='1500 m radius; bounded community-mapped inventory';
 sources[2].coverage=s.status==='fulfilled'?s.value.coverage:'Satellite request failed';
 const latest=hotspots.map(h=>h.provenance.observedAt).filter(t=>Number.isFinite(Date.parse(t))&&Date.parse(t)<=Date.now()).sort();sources[2].observedAt=latest.at(-1);
 if(w.status==='rejected')sources[0].detail+=' Request failed or forecast validation rejected incomplete data.';
 if(g.status==='rejected')sources[1].detail+=' Both bounded public-source attempts failed or returned incomplete results.';
 if(s.status==='rejected')sources[2].detail+=' Feed request or schema validation failed.';
 if(s.status==='fulfilled')sources[2].detail+=' '+s.value.detail;
 if(g.status==='fulfilled'&&g.value.truncated)reasons.push('Geographic result limit reached: asset inventory is incomplete.');
 const exposure=await readExposure(lon,lat,1500,!!adverse.length||!!(satelliteCovered&&recent.length));
 sources.push({source:'Catalonia exposure inventory',status:exposure.status==='ready'?'live':exposure.status==='stale'?'stale':'unavailable',retrievedAt:exposure.importedAt||now,observedAt:exposure.sourceDate||undefined,coverage:'Stored regional OpenStreetMap / Geofabrik extract; inspection circle plus 1 km buffer',detail:exposure.detail});
 const exposureNote=exposureReason(exposure);if(exposureNote)reasons.push(exposureNote);
 return{exposure,planningContext:await planningPromise,deepfire,...(weatherNext?{weatherNext}:{}),location:{lat,lon,radiusM:1500},generatedAt:now,sources,weather:weatherData,vegetationDryness,geography:geo,satellite:{hotspots:satelliteCovered?hotspots:[],frpTrend:[],escalation:null},sage:{state:satelliteCovered&&recent.length&&adverse.length?'escalating':recent.length||adverse.length||dryHours.length||!satelliteCovered||sources.some(s=>s.status==='stale')||results.some(r=>r.status==='rejected')?'review':'monitoring',reasons,ruleVersion:'sage-triage-2 · fine-fuel dryness screening; heuristic, uncalibrated'},completeness:{available:sources.filter(s=>s.status==='live').map(s=>s.source),missing:['Validated fuel models','Dead/live fuel moisture','Terrain slope/aspect rasters','Confirmed active fire perimeter','Validated population and road capacities','Matched FRP acquisitions',...(weatherData.outlook.length<24?['Complete 24-hour weather outlook']:[]),...(!satelliteCovered?['Satellite coverage at requested location']:[]),...sources.filter(s=>s.status!=='live').map(s=>`${s.source}: ${s.status}`),...(g.status==='fulfilled'&&g.value.truncated?['Complete geographic inventory']:[])]},forecast:{available:false,reason:'Numerical spread, fire arrival and evacuation margins withheld: validated fuel, moisture, terrain and ignition inputs are missing.'},units:{temperature:'°C',wind:'km/h at 10 m',direction:'degrees meteorological FROM north',precipitation:'mm per preceding hour',elevation:'m above sea level (weather grid DEM)',frp:'MW'}};
}

export async function assessLocation(lat:number,lon:number,waitForRefresh=false):Promise<Assessment>{
 validateLocation(lat,lon);lat=Number(lat.toFixed(5));lon=Number(lon.toFixed(5));
 return backendSnapshot(`assessment-v3-exposure-dryness:${lat}:${lon}`,()=>loadAssessment(lat,lon),value=>{
  value.sources=value.sources.map(source=>source.status==='live'?{...source,status:'stale',detail:source.detail+' Backend refresh pending; showing saved evidence.'}:source);
  if(value.deepfire)value.deepfire.sources=value.deepfire.sources.map(source=>source.status==='live'?{...source,status:'stale'}:source);
  if(value.exposure){value.sage.reasons=value.sage.reasons.filter(reason=>!reason.startsWith('Nearby people and infrastructure:'));value.exposure.uplift=0;value.exposure.hazardActive=false;value.exposure.detail+=' Saved assessment: fresh hazard evaluation pending.';}
  if(value.vegetationDryness){value.vegetationDryness.status='stale';value.vegetationDryness.detail='Saved dryness estimate; weather refresh pending. Check its valid time before use.';}
  value.sage.state='review';value.sage.reasons.unshift('Saved assessment; background refresh pending. Check evidence timestamps.');
  value.completeness.available=[];value.completeness.missing.push('Fresh backend assessment');
  return value;
 },300000,3600000,waitForRefresh);
}
