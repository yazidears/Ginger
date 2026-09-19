import {readExposureIndex} from '../exposure/store';
import {activityContext, connectedFuelAreas, scorePrevention, PREVENTION_METHOD} from './prevention';
import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {HORIZONS,type Geography,type Snapshot,type StationResult,type CellResult,type GridCell,type Weather,type Station} from './types';
import {hourlyFFMC,frame,round,MODEL_VERSION} from './model';
import {loadStations,loadXema,loadForecast,loadOfficial,concurrent,atomicJSON,DATA_DIR,type Forecast} from './providers';
const HOUR=3600000;
export function distanceKm(a:number[],b:number[]){const p=Math.PI/180;const dLat=(b[1]-a[1])*p,dLon=(b[0]-a[0])*p;const x=Math.sin(dLat/2)**2+Math.cos(a[1]*p)*Math.cos(b[1]*p)*Math.sin(dLon/2)**2;return 6371*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));}
function insideRing(point:number[],ring:number[][]){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
function within(point:number[],geometry:GeoJSON.Polygon|GeoJSON.MultiPolygon){return (geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates).some(p=>insideRing(point,p[0])&&!p.slice(1).some(r=>insideRing(point,r)));}
export function assimilate(station:Station,weather:Weather[],history:StationResult['history'],forecast:Forecast|null,now:number):StationResult|null{
 const latest=weather.at(-1);if(!latest||now-Date.parse(latest.time)>90*60000||Date.parse(latest.time)>now||history.continuousHours<48)return null;
 let ffmc=85,previous:number|null=null;let continuous=0;
 for(const w of weather){const time=Date.parse(w.time);if(previous!==null&&Math.abs(time-previous-w.stepHours*HOUR)>1000){ffmc=85;continuous=0;}ffmc=hourlyFFMC(ffmc,w);continuous+=w.stepHours;previous=time;}
 if(continuous<48)return null;
 const current=frame(ffmc,latest,0),frames=[current];
 if(forecast){
  let end=Math.max(Date.parse(latest.time),Math.floor(now/HOUR)*HOUR),code=ffmc;const anchor=Math.floor(now/HOUR)*HOUR;
  const targets=new Map(HORIZONS.filter(h=>h>0).map(h=>[anchor+h*HOUR,h]));
  for(const w of forecast.weather){const t=Date.parse(w.time);if(t<=end)continue;const dt=(t-end)/HOUR;if(dt>1.00001)break;
   if(dt<=0)continue;
   // For a half-hour bridge, forecast rain is estimated uniformly within its stated hour.
   const step={...w,stepHours:dt,precipitation:w.precipitation*dt};code=hourlyFFMC(code,step);end=t;
   const horizon=targets.get(t);if(horizon){const f=frame(code,w,horizon);f.velocity=round((f.fireReceptivity-current.fireReceptivity)/((t-Date.parse(latest.time))/HOUR),2);frames.push(f);}
   if(t>=anchor+24*HOUR)break;
  }
 }
 return {station,frames,history:{...history,continuousHours:continuous},forecastSource:forecast?.source??null,forecastIssuedAt:forecast?.issuedAt??null,quality:[`FFMC initialized at 85; ${Math.floor(continuous)} uninterrupted observation hours since initialization.`,`Station measurements transferred to surrounding cells; no 200 m weather or live-fuel moisture claim.`,...(forecast?[forecast.detail]:['Forecast unavailable; future scores remain missing.']), `Forecast initialization holds the latest observed fuel state to the current hour (at most 90 minutes); this bridge is an estimate.`, 'Soil moisture and recent ET are unavailable from XEMA. Missing values are not replaced.']};
}
async function geography(){return JSON.parse(await readFile(join(process.cwd(),'data/receptivity/barcelona-grid.json'),'utf8')) as Geography;}
export async function computeSnapshot():Promise<Snapshot>{
 const now=Date.now(),[geo,stations,official]=await Promise.all([geography(),loadStations(),loadOfficial()]);
 const [exposure, extents] = await Promise.all([readExposureIndex().catch(() => null), Promise.resolve(connectedFuelAreas(geo.cells, geo.cellSizeM))]);
 const failures:string[]=[];
 const results=await concurrent(stations,async station=>{
  try{const past=await loadXema(station,now);if(!past.weather.length||past.history.continuousHours<48){failures.push(`${station.name}: insufficient continuous T/RH/10 m wind/rain history`);return null;}
   let forecast:Forecast|null=null;try{forecast=await loadForecast(station,now);}catch{failures.push(`${station.name}: forecast unavailable`);}
   const result=assimilate(station,past.weather,past.history,forecast,now);if(!result)failures.push(`${station.name}: stale observations or interrupted history`);return result;
  }catch(e){failures.push(`${station.name}: ${e instanceof Error?e.message:'source failure'}`);return null;}
 },4);
 const valid=results.filter((s):s is StationResult=>s!==null);
 if(!valid.length)throw Error('No fresh XEMA station with 48 hours of continuous required weather. No current scores published.');
 const municipalities=official.features.features.map(f=>{const coords=f.geometry.type==='Polygon'?f.geometry.coordinates.flat():f.geometry.coordinates.flat(2);const xs=coords.map(p=>p[0]),ys=coords.map(p=>p[1]);return {f,bbox:[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]};});
 const cells:CellResult[]=geo.cells.map((cell:GridCell)=>{
  // Nearest station in horizontal distance. No hidden elevation correction or fabricated downscaling.
  const near=valid.map(s=>({s,d:distanceKm(cell.center,s.station.center)})).sort((a,b)=>a.d-b.d)[0];
  const assigned=near.d<=20;const nameFeature=municipalities.find(({bbox:b,f})=>cell.center[0]>=b[0]&&cell.center[0]<=b[2]&&cell.center[1]>=b[1]&&cell.center[1]<=b[3]&&within(cell.center,f.geometry))?.f;
  const fuelLabel=cell.fuel.type==='Tree cover'?'forest':cell.fuel.type.toLowerCase();
  const name=nameFeature?.properties?.NOMMUNI?`${nameFeature.properties.NOMMUNI} · ${fuelLabel}`:`${cell.center[1].toFixed(3)}° N, ${cell.center[0].toFixed(3)}° E · ${fuelLabel}`;
  const rec=HORIZONS.map(h=>assigned?near.s.frames.find(f=>f.horizon===h)?.fireReceptivity??null:null),spread=HORIZONS.map(h=>assigned?near.s.frames.find(f=>f.horizon===h)?.spreadPotential??null:null);
  // Evidence completeness score, explicitly not a statistical confidence probability.
  let quality=assigned?0.7:0;quality-=Math.min(.2,near.d/100);if(cell.fuel.ndmi===undefined)quality-=.1;if(cell.terrain.slope===undefined)quality-=.1;if(Math.abs((cell.terrain.elevation??near.s.station.elevation)-near.s.station.elevation)>300)quality-=.1;
  const f3=near.s.frames.find(f=>f.horizon===3);
  const prevention=scorePrevention({receptivity:rec,spread}, {connectedFuelHa:extents.get(cell.id)??null,...activityContext(cell,exposure,geo.cellSizeM)});
  return {...cell,prevention,name,stationId:assigned?near.s.station.id:'',stationDistanceKm:round(near.d),confidence:round(Math.max(0,quality),2),confidenceLabel:quality>=.65?'moderate':'limited',receptivity:rec,spread,velocity:assigned?f3?.velocity??null:null,...(official.comparable&&nameFeature?{officialLevel:Number(nameFeature.properties?.PERIL_M)}:{})};
 });
 const times=valid.map(s=>s.frames[0].timestamp).sort();const generatedAt=new Date().toISOString();
 const snapshot:Snapshot={preventionMethod:PREVENTION_METHOD,version:MODEL_VERSION,generatedAt,nextRefreshAt:new Date(Date.now()+15*60000).toISOString(),observationRange:{oldest:times[0],newest:times.at(-1)!},region:'Barcelona metropolitan forests',areaKm2:geo.areaKm2,cellSizeM:geo.cellSizeM,bbox:geo.bbox,horizons:HORIZONS,cells,stations:valid,official,sources:[
  {id:'xema',name:'Meteocat · XEMA',status:'live',url:'https://www.meteo.cat/wpweb/serveis/dades-obertes/',retrievedAt:generatedAt,validAt:times[0],refreshMinutes:30,detail:`${valid.length}/${stations.length} stations have fresh observations and at least 48 uninterrupted hours. T/RH/rain/10 m wind; rolling rain up to 30 days. Observation flags may be provisional or absent.`},
  {id:'forecast',name:[...new Set(valid.map(s=>s.forecastSource).filter(Boolean))].join(' / ')||'Forecast',status:valid.some(s=>s.frames.length>1)?'live':'unavailable',url:valid.some(s=>s.forecastSource==='MET Norway')?'https://api.met.no/doc/ForecastJSON':'https://open-meteo.com/en/docs',retrievedAt:generatedAt,validAt:valid.map(s=>s.forecastIssuedAt).filter((s):s is string=>!!s).sort()[0],refreshMinutes:60,detail:valid.find(s=>s.forecastSource)?.quality[2]||'No forecast available.'},
  ...geo.sources.map((s,i)=>({id:`geography-${i}`,name:s.name,status:'reference' as const,url:s.url,retrievedAt:geo.preparedAt,detail:s.detail})),
  {id:'prevention-activity',name:'Mapped human activity proxy',status:exposure?(now-Date.parse(exposure.data.metadata.sourceDate)>30*86400000?'stale':'reference'):'unavailable',url:exposure?.data.metadata.sourceUrl??'https://www.openstreetmap.org',retrievedAt:exposure?.data.metadata.importedAt,validAt:exposure?.data.metadata.sourceDate,detail:exposure?`Roads, complexes and gathering places from the exposure inventory. Not observed footfall. ${exposure.data.metadata.skipped} skipped features; incomplete or uncovered cells have no activity score.`:'Activity inventory unavailable; prevention scores require an explicit activity scenario until the import completes.'},
  official.status,
  {id:'danger',name:'Generalitat · Mapa de perill',status:'reference',url:'https://agricultura.gencat.cat/ca/ambits/medi-natural/incendis-forestals/mapes/mapa-perill-incendi/',detail:'Official daily forest-fire danger is a distinct product. No verified current machine-readable feed is used in this engine; the public Pla Alfa service is integrated separately.'}
 ],counts:{vegetated:cells.length,assessed:cells.filter(c=>c.receptivity[0]!==null).length,high:cells.filter(c=>c.receptivity[0]!==null&&c.receptivity[0]>=65&&c.receptivity[0]<80).length,veryHigh:cells.filter(c=>c.receptivity[0]!==null&&c.receptivity[0]>=80&&c.receptivity[0]<90).length,extreme:cells.filter(c=>c.receptivity[0]!==null&&c.receptivity[0]>=90).length},warnings:[
 'Experimental deterministic index; not calibrated against Catalan ignition outcomes. No ignition occurrence or probability is predicted.',
 'Fine-fuel moisture is a litter-model estimate. Live-fuel moisture, fuel loads and canopy structure are unmeasured. Terrain and satellite moisture are contextual and do not alter FFMC/ISI.',
 'The 200 m cells resolve mapped vegetation; environmental weather support is station-scale. Adjacent cells may share scores.',
 ...failures
 ]};
 await atomicJSON(join(DATA_DIR,'latest.json'),snapshot);return snapshot;
}
const state=globalThis as typeof globalThis & {receptivitySnapshot?:Snapshot;receptivityPending?:Promise<Snapshot>;receptivityError?:string;receptivityMtime?:number;receptivityTimer?:ReturnType<typeof setTimeout>};
export async function refreshReceptivity(){if(state.receptivityPending)return state.receptivityPending;state.receptivityPending=computeSnapshot().then(s=>{state.receptivitySnapshot=s;state.receptivityError=undefined;return s;}).catch(e=>{state.receptivityError=e instanceof Error?e.message:'Refresh failed';throw e;}).finally(()=>{state.receptivityPending=undefined;});return state.receptivityPending;}
export async function readReceptivity(){
 try{const file=join(DATA_DIR,'latest.json'),info=await stat(file);if(info.mtimeMs!==state.receptivityMtime){state.receptivitySnapshot=JSON.parse(await readFile(file,'utf8'));state.receptivityMtime=info.mtimeMs;}}catch{}
 const s=state.receptivitySnapshot;
 if(process.env.GINGER_EXTERNAL_WORKER!=='1'&&(!s||Date.now()-Date.parse(s.generatedAt)>15*60000))void refreshReceptivity().catch(()=>{});
 return {snapshot:s??null,refreshing:!!state.receptivityPending,error:state.receptivityError??null,stale:!!s&&(Date.now()-Date.parse(s.generatedAt)>35*60000||!!s.observationRange&&Date.now()-Date.parse(s.observationRange.oldest)>90*60000)};
}
export function startReceptivityRefresh(){if(state.receptivityTimer)return;async function tick(){try{await refreshReceptivity();}catch(e){console.warn('[GINGER receptivity]',e instanceof Error?e.message:'refresh failed');}finally{state.receptivityTimer=setTimeout(tick,15*60000);state.receptivityTimer.unref();}}state.receptivityTimer=setTimeout(tick,1000);state.receptivityTimer.unref();}
