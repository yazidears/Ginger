import {readExposure} from './exposure/store';
import {exposureReason} from './exposure/model';
import type {ExposureSummary} from './exposure/types';
import {locationHotspots,type SatelliteResult} from './providers/satellite';
import {readLocationWeather} from './assessment';
import type {Assessment} from './assessment';
import type {Hotspot,ProviderResult} from './providers/types';
import {distanceKm} from './simulation';
import {recordThermalHistory} from './sage/thermal-store';
import {watchAreaStore} from './watch-areas';
import {providerFailure} from './providers/http';
export function weatherUnavailableReason(error: unknown) {
 const reason=providerFailure(error);
 return reason==='Provider returned HTTP 429'
  ? 'Weather service is temporarily limiting requests. Monitoring will retry on the next scheduled scan.'
  : 'Weather unavailable. '+reason+'. Monitoring will retry on the next scheduled scan.';
}
export const watchAreas=[{id:'garraf',name:'Garraf',position:[1.86,41.3]},{id:'penedes',name:'Alt Penedès',position:[1.69,41.35]},{id:'bages',name:'Bages',position:[1.83,41.73]},{id:'montseny',name:'Montseny',position:[2.4,41.76]},{id:'ebre',name:'Terres de l’Ebre',position:[.52,40.82]},{id:'emporda',name:'Alt Empordà',position:[2.96,42.27]}] as const;
export type MonitorZone={exposure?:ExposureSummary;id:string;name:string;position:readonly [number,number];state:'monitoring'|'review'|'escalating'|'unavailable';temperature:number|null;humidity:number|null;windKmh:number|null;windFromDegrees?:number|null;hotspots:number|null;reasons:string[];updatedAt:string;radiusM?:number;detectionIds?:string[];evidence?:{satelliteSource?:string;weatherValidAt:string|null;weatherRetrievedAt:string|null;satelliteRetrievedAt:string|null;newestDetectionAt:string|null;weatherAgeMinutes:number|null;satelliteAgeMinutes:number|null;coverage:string};hazardWindow?:{startsAt:string;endsAt:string}|null};
export type MonitorChange={id:string;zoneId:string;time:string;area:string;kind:'wind'|'weather'|'detections'|'window'|'coverage'|'status'|'exposure';title:string;text:string};
export type MonitorSnapshot={zones:MonitorZone[];lastScan:string|null;nextScan:string|null;scanning:boolean;deltas:MonitorChange[];coverage:string};
type State={snapshot:MonitorSnapshot;timer:ReturnType<typeof setInterval>|null;pending:Promise<void>|null;areaKey?:string};
const globalMonitor=globalThis as typeof globalThis & {gingerMonitor?:State};
const state=globalMonitor.gingerMonitor??={snapshot:{zones:[],lastScan:null,nextScan:null,scanning:false,deltas:[],coverage:'Six monitored Catalonia sectors; satellite detections within 15 km of each point. Add inspection by clicking any map location.'},timer:null,pending:null};
export type MonitorWeather={data:Assessment['weather'];retrievedAt:string};
/** Review rules only: no calibrated ignition probability or fire-spread forecast. */
export function evaluateZone(a:{id:string;name:string;position:readonly [number,number];radiusM?:number},weather:MonitorWeather|null,fire:(ProviderResult<Hotspot[]>&Partial<Pick<SatelliteResult,'covered'|'coverage'|'source'>>)|null,now=Date.now()):MonitorZone{
 const age=(time:string)=>now-Date.parse(time);
 const current=weather?.data.current;
 const weatherReady=!!current&&!!weather&&age(weather.retrievedAt)>=0&&age(weather.retrievedAt)<=20*60000&&age(current.time)>=0&&age(current.time)<3600000;
 const radiusKm=(a.radiusM??15000)/1000;
 const inEurope=a.position[1]>=34&&a.position[1]<=72&&a.position[0]>=-25&&a.position[0]<=45;
 const covered=fire?.covered??inEurope;
 const satelliteReady=covered&&fire?.status==='live'&&age(fire.updatedAt)>=0&&age(fire.updatedAt)<=30*60000;
 const nearby=satelliteReady?fire.data.filter(h=>distanceKm([...a.position],h.position)<=radiusKm&&age(h.provenance.observedAt)>=0&&age(h.provenance.observedAt)<=6*3600000):undefined;
 const adverse=weatherReady?weather!.data.outlook.filter(h=>Date.parse(h.time)>=Math.floor(now/3600000)*3600000&&Date.parse(h.time)<now+24*3600000&&h.humidityPct<=25&&h.windKmh>=25&&h.temperatureC>=28).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time)):[];
 const reasons:string[]=[];
 if(nearby?.length)reasons.push(`${nearby.length} thermal detections within ${radiusKm} km during the past 6 hours require verification; not confirmed fires.`);
 if(adverse.length)reasons.push(`${adverse.length} hours in the next 24h combine ≥28°C, ≤25% humidity and ≥25 km/h wind; first at ${adverse[0].time}.`);
 if(!weatherReady)reasons.push('Weather unavailable or stale.');
 if(!satelliteReady)reasons.push(covered?'Satellite feed unavailable or stale.':'Satellite coverage unavailable outside the configured feed.');
 if(fire?.source)reasons.push(`${fire.source}. ${fire.detail}`);
 if(!reasons.length)reasons.push('No configured escalation rule is currently met. This is not an all-clear.');
 let end=adverse[0]?Date.parse(adverse[0].time)+3600000:null;
 for(const hour of adverse.slice(1)){if(Date.parse(hour.time)!==end)break;end+=3600000;}
 const latest=nearby?.length?nearby.reduce((a,b)=>Date.parse(a.provenance.observedAt)>Date.parse(b.provenance.observedAt)?a:b).provenance.observedAt:null;
 return{radiusM:a.radiusM??15000,detectionIds:nearby?.map(h=>h.id).sort(),evidence:{satelliteSource:fire?.source,weatherValidAt:current?.time??null,weatherRetrievedAt:weather?.retrievedAt??null,satelliteRetrievedAt:fire?.updatedAt??null,newestDetectionAt:latest,weatherAgeMinutes:weather?Math.max(0,Math.round(age(weather.retrievedAt)/60000)):null,satelliteAgeMinutes:fire?Math.max(0,Math.round(age(fire.updatedAt)/60000)):null,coverage:fire?.coverage??(inEurope?'Europe satellite feed; absence of detections does not establish a clear observation.':'Outside configured satellite coverage')},id:a.id,name:a.name,position:a.position,state:!weatherReady&&!satelliteReady?'unavailable':adverse.length&&nearby?.length?'escalating':!weatherReady||!satelliteReady||adverse.length||nearby?.length?'review':'monitoring',temperature:weatherReady?current!.temperatureC:null,humidity:weatherReady?current!.humidityPct:null,windKmh:weatherReady?current!.windKmh:null,windFromDegrees:weatherReady?current!.windFromDegrees:null,hotspots:nearby?.length??null,reasons,hazardWindow:adverse.length?{startsAt:adverse[0].time,endsAt:new Date(end!).toISOString()}:null,updatedAt:new Date(now).toISOString()};
}
async function scan(){
 if(state.pending)return state.pending;
 state.snapshot.scanning=true;
 state.pending=(async()=>{
  const areas=await watchAreaStore.list();
  const areaKey=JSON.stringify(areas.map(a=>[a.id,a.name,a.lat,a.lon,a.radiusM]));
  const zones:MonitorZone[]=new Array(areas.length);const thermal:Hotspot[]=[];let cursor=0;
  // Bound upstream weather requests even when the watch list grows.
  await Promise.all(Array.from({length:Math.min(4,areas.length)},async()=>{
   for(;;){const index=cursor++;if(index>=areas.length)return;const a=areas[index];
    let weatherIssue: string|undefined;
    const [w,fire]=await Promise.all([readLocationWeather(a.lat,a.lon).catch(error=>{weatherIssue=weatherUnavailableReason(error);return null;}),locationHotspots(a.lat,a.lon,a.radiusM/1000).catch(()=>null)]);
    if(fire)thermal.push(...fire.data);
    const zone=evaluateZone({...a,position:[a.lon,a.lat]},w,fire);
    if(weatherIssue)zone.reasons=zone.reasons.map(reason=>reason==='Weather unavailable or stale.'?weatherIssue!:reason);
    zone.exposure=await readExposure(a.lon,a.lat,a.radiusM,!!zone.hazardWindow||!!zone.hotspots);
    const reason=exposureReason(zone.exposure);if(reason)zone.reasons.push(reason);
    zones[index]=zone;
   }
  }));
  await recordThermalHistory(thermal).catch(()=>console.warn('Thermal history could not be saved; monitoring continues.'));
  const now=new Date().toISOString();
  const changes=zones.flatMap(z=>detectChanges(state.snapshot.zones.find(p=>p.id===z.id),z));
  state.areaKey=areaKey;
  state.snapshot={...state.snapshot,zones,lastScan:now,nextScan:new Date(Date.now()+600000).toISOString(),scanning:false,deltas:[...changes,...state.snapshot.deltas].slice(0,50),coverage:`${areas.length} saved watch areas; weather checked every 10 minutes. Deepfire is used when configured, with a Europe-only NASA FIRMS fallback; detections use each area's radius and a rolling 6-hour window.`};
 })().finally(()=>{state.pending=null;state.snapshot.scanning=false;});
 return state.pending;
}
export async function getMonitor(){
 if(!state.timer){state.timer=setInterval(()=>void scan().catch(()=>{}),600000);state.timer.unref();}
 const areas=await watchAreaStore.list();
 const key=JSON.stringify(areas.map(a=>[a.id,a.name,a.lat,a.lon,a.radiusM]));
 if(!state.snapshot.lastScan||state.areaKey!==key)await scan();
 return state.snapshot;
}

/** Compare consecutive scans. Missing evidence is a coverage change, never zero. */
export function detectChanges(previous:MonitorZone|undefined,next:MonitorZone):MonitorChange[]{
 if(!previous)return[];
 const changes:MonitorChange[]=[];
 const add=(kind:MonitorChange['kind'],title:string,text:string)=>changes.push({id:`${next.id}:${next.updatedAt}:${kind}:${changes.length}`,zoneId:next.id,time:next.updatedAt,area:next.name,kind,title,text});
 const numeric=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
 for(const [key,label,threshold,unit,kind] of [
  ['windKmh','Wind speed',5,'km/h','wind'],['temperature','Temperature',3,'°C','weather'],['humidity','Humidity',10,'% RH','weather']
 ] as const){const before=previous[key],after=next[key];if(numeric(before)&&numeric(after)&&Math.abs(after-before)>=threshold)add(kind,`${label} ${after>before?'increased':'decreased'}`,`${before} → ${after} ${unit} since the previous scan.`);}
 const from=previous.windFromDegrees,to=next.windFromDegrees;
 if(numeric(from)&&numeric(to)&&numeric(previous.windKmh)&&numeric(next.windKmh)&&Math.min(previous.windKmh,next.windKmh)>=5){const turn=Math.abs(((to-from+540)%360)-180);if(turn>=15)add('wind','Wind direction shifted',`From ${from}° → ${to}° (${Math.round(turn)}° shift). Meteorological FROM direction; review spread assumptions.`);}
 const sourceChanged=previous.evidence?.satelliteSource!==next.evidence?.satelliteSource;
 if(sourceChanged)add('coverage','Satellite source changed',`${previous.evidence?.satelliteSource??'Unavailable'} → ${next.evidence?.satelliteSource??'Unavailable'}. Detection counts are not directly comparable across providers.`);
 const added=!sourceChanged&&previous.detectionIds&&next.detectionIds?next.detectionIds.filter(id=>!previous.detectionIds!.includes(id)):[];
 if(added.length&&previous.hotspots===next.hotspots)add('detections','New thermal observations',`${added.length} new observations entered the rolling window while the total stayed ${next.hotspots}. Verify location and source before interpreting growth.`);
 if(!sourceChanged&&numeric(previous.hotspots)&&numeric(next.hotspots)&&previous.hotspots!==next.hotspots)add('detections','Thermal detection count changed',`${previous.hotspots} → ${next.hotspots} detections in the rolling 6-hour window. Detections require verification; a decrease can reflect ageing observations.`);
 const coverage=(z:MonitorZone)=>[numeric(z.windKmh)&&numeric(z.temperature)&&numeric(z.humidity),numeric(z.hotspots)];
 const beforeCoverage=coverage(previous),afterCoverage=coverage(next);
 ['Weather','Satellite'].forEach((label,i)=>{if(beforeCoverage[i]!==afterCoverage[i])add('coverage',`${label} coverage ${afterCoverage[i]?'restored':'lost'}`,afterCoverage[i]?'Fresh evidence is available again.':'Evidence is unavailable or stale. Previous values are not treated as zero.');});
 if(beforeCoverage[0]&&afterCoverage[0]){const a=previous.hazardWindow,b=next.hazardWindow;if(a?.startsAt!==b?.startsAt||a?.endsAt!==b?.endsAt)add('window',!a?'Hazardous weather window appeared':!b?'Hazardous weather window no longer forecast':'Hazardous weather timing changed',`${a?`${a.startsAt} – ${a.endsAt}`:'No qualifying window'} → ${b?`${b.startsAt} – ${b.endsAt}`:'No qualifying window'}. Hourly forecast; not fire arrival.`);}
 if(previous.exposure&&next.exposure&&previous.exposure.uplift!==next.exposure.uplift)add('exposure','Nearby asset priority changed',`${previous.exposure.uplift} → ${next.exposure.uplift}/40 exposure contribution. ${next.exposure.detail}`);
 if(previous.state!==next.state)add('status','Sector review status changed',`${previous.state} → ${next.state}. ${next.reasons[0]}`);
 return changes;
}
