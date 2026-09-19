import type {Assessment, WeatherHour} from './assessment';
import {extremeDrynessHours} from './vegetation-dryness';

export type Intelligence = {
 headline:string;priority:'review'|'monitoring'|'escalating';briefing:string;
 evidence:{id:string;label:string;value:string;source:string;time:string}[];
 actions:{id:string;title:string;reason:string;evidenceIds:string[]}[];
 weatherWindows:{start:string;end:string;label:string;reason:string}[];
 limitations:string[];
};
const HOUR=3_600_000;
const adverse=(h:WeatherHour)=>h.temperatureC>=28&&h.humidityPct<=25&&h.windKmh>=25;
const values=(h:WeatherHour)=>`${h.temperatureC.toFixed(1)}°C, ${h.humidityPct.toFixed(0)}% RH, ${h.windKmh.toFixed(1)} km/h wind`;
/** Deterministic, rules-based triage. Not a calibrated ignition or spread model. */
export function deriveIntelligence(a:Assessment):Intelligence{
 const evidence:Intelligence['evidence']=[],actions:Intelligence['actions']=[],weatherWindows:Intelligence['weatherWindows']=[];
 const add=(id:string,label:string,value:string,source:string,time=a.generatedAt)=>evidence.push({id,label,value,source,time});
 const source=(pattern:RegExp)=>a.sources.find(s=>pattern.test(s.source));
 const weatherSource=source(/Open-Meteo/i),satelliteSource=source(/FIRMS|Deepfire|Satellite detections/i),geographySource=source(/OpenStreetMap/i);
 const now=Date.parse(a.generatedAt),start=Math.floor(now/HOUR)*HOUR;
 const hours=weatherSource?.status==='live'?a.weather.outlook.filter(h=>Number.isFinite(Date.parse(h.time))&&Date.parse(h.time)>=start&&Date.parse(h.time)<start+24*HOUR&&[h.temperatureC,h.humidityPct,h.windKmh].every(Number.isFinite)&&h.humidityPct>=0&&h.humidityPct<=100&&h.windKmh>=0).sort((x,y)=>Date.parse(x.time)-Date.parse(y.time)).filter((h,i,list)=>i===0||h.time!==list[i-1].time):[];
 const complete=hours.length===24&&hours.every((h,i)=>Date.parse(h.time)===start+i*HOUR);
 add('RULE','Assessment method','Rules-based review threshold: temperature ≥28°C AND humidity ≤25% AND wind ≥25 km/h in the same forecast hour. Not a probability.','GINGER triage rule v1');
 add('COVERAGE','Source availability',a.sources.map(s=>`${s.source}: ${s.status}`).join('; ')||'No sources available','Provider health');
 add('WEATHER','Weather coverage',`${hours.length}/24 usable hourly forecasts; ${weatherSource?.status||'unavailable'}`,weatherSource?.source||'Weather unavailable',weatherSource?.retrievedAt||a.generatedAt);
 const dryness=a.vegetationDryness;
 const dryHours=complete&&weatherSource?.status==='live'&&dryness?.current&&Date.parse(dryness.current.time)===start?extremeDrynessHours(dryness):[];
 if(dryness)add('DRYNESS','Vegetation dryness',dryness.status==='estimated'&&weatherSource?.status==='live'&&dryness.current&&Date.parse(dryness.current.time)===start?`${dryness.detail} ${dryHours.length} forecast hours below the Ginger 6% screening threshold; not an official danger class.`:dryness.status==='unavailable'?dryness.detail:'Dryness estimate is stale or its weather source is unavailable.',dryness.source,dryness.current?.time||a.generatedAt);
 const risky=hours.filter(adverse);
 if(hours.length){
  // Rank only for inspection: count concurrent adverse conditions, then lowest humidity and highest wind.
  const rank=(h:WeatherHour)=>Number(h.temperatureC>=28)+Number(h.humidityPct<=25)+Number(h.windKmh>=25);
  const peak=[...hours].sort((x,y)=>rank(y)-rank(x)||x.humidityPct-y.humidityPct||y.windKmh-x.windKmh||Date.parse(x.time)-Date.parse(y.time))[0];
  add('PEAK','Priority weather hour',`${values(peak)}; ${risky.length} hours meet all three review thresholds`,weatherSource!.source,peak.time);
  const groups:WeatherHour[][]=[];
  for(const h of risky){const last=groups.at(-1);if(last&&Date.parse(h.time)-Date.parse(last.at(-1)!.time)===HOUR)last.push(h);else groups.push([h]);}
  for(const group of groups){const first=group[0],last=group.at(-1)!;weatherWindows.push({start:first.time,end:new Date(Date.parse(last.time)+HOUR).toISOString(),label:'Concurrent fire-weather review conditions',reason:`${group.length} hourly intervals meet all three configured thresholds [RULE, PEAK]. Modelled weather; not ignition probability.`});}
  if(!groups.length)weatherWindows.push({start:peak.time,end:new Date(Date.parse(peak.time)+HOUR).toISOString(),label:'Priority hour to inspect',reason:`${values(peak)}. Ranked by concurrent threshold count, humidity, then wind; no hour meets all three thresholds [RULE, PEAK].`});
 }
 const recent=satelliteSource?.status==='live'?a.satellite.hotspots.filter(h=>{const age=now-Date.parse(h.provenance.observedAt);return Number.isFinite(age)&&age>=0&&age<6*HOUR;}):[];
 add('THERMAL','Recent satellite evidence',satelliteSource?.status==='live'?`${recent.length} thermal detections in the assessed 10 km neighbourhood during the preceding 6 hours; not confirmed wildfires`:`Recent thermal detection assessment unavailable (${satelliteSource?.status||'unavailable'})`,satelliteSource?.source||'Satellite unavailable',satelliteSource?.retrievedAt||a.generatedAt);
 if(recent.length){const newest=[...recent].sort((x,y)=>Date.parse(y.provenance.observedAt)-Date.parse(x.provenance.observedAt))[0];add('LATEST','Latest thermal observation',`Observed thermal detection; ${Number.isFinite(newest.frpMw)?`${newest.frpMw} MW FRP`:'FRP unavailable'}. A point detection is not a fire perimeter.`,newest.provenance.source,newest.provenance.observedAt);}
 const geoLive=geographySource?.status==='live';
 add('GEOGRAPHY','Mapped inventory',geoLive?`${a.geography.buildings.features.length} building footprints; ${a.geography.roads.features.length} road features; ${a.geography.assets.features.length} facility features within ${a.location.radiusM} m. Completeness unknown.`:'Geographic inventory unavailable; empty collections do not establish absence of assets.',geographySource?.source||'Geography unavailable',geographySource?.retrievedAt||a.generatedAt);
 if(a.exposure)add('EXPOSURE','People and infrastructure',`${a.exposure.total??'Unknown'} mapped features; +${a.exposure.uplift}/40 exposure priority; ${a.exposure.status}. ${a.exposure.detail}`,'OpenStreetMap / Geofabrik Catalonia inventory',a.exposure.sourceDate||a.generatedAt);
 add('FORECAST','Physical forecast readiness',a.forecast.reason,'GINGER input validation');
 const missing=[...new Set(a.completeness.missing)];
 add('GAPS','Missing model inputs',missing.join('; ')||'No explicit missing-input list supplied; forecast validation still required.','GINGER input validation');
 const degraded=!complete||!geoLive||!satelliteSource||satelliteSource.status!=='live'||a.sources.some(s=>s.status!=='live');
 const priority: Intelligence['priority']=recent.length&&risky.length?'escalating':recent.length||risky.length||dryHours.length||degraded?'review':'monitoring';
 if(recent.length)actions.push({id:'verify-thermal',title:'Verify thermal detections',reason:`${recent.length} recent detections need camera or field corroboration and checks for industrial heat sources before identifying an incident [THERMAL].`,evidenceIds:['THERMAL',...(evidence.some(e=>e.id==='LATEST')?['LATEST']:[])]});
 if(risky.length)actions.push({id:'weather-readiness',title:'Review readiness during the weather window',reason:`${risky.length} forecast hours combine heat, low humidity and wind at the configured thresholds; review surveillance coverage and available response capacity [RULE, PEAK].`,evidenceIds:['RULE','PEAK']});
 if(dryHours.length)actions.push({id:'inspect-dry-fuels',title:'Inspect extremely dry fine fuels',reason:`${dryHours.length} forecast hours have estimated dead fine-fuel moisture below 6%. Verify vegetation condition and continuity near assets; live plant moisture is unknown [DRYNESS].`,evidenceIds:['DRYNESS']});
 if(degraded)actions.push({id:'restore-evidence',title:'Resolve assessment coverage gaps',reason:'Check missing or stale feeds and incomplete hourly coverage before drawing conclusions from absent detections or empty maps [COVERAGE, WEATHER, GEOGRAPHY].',evidenceIds:['COVERAGE','WEATHER','GEOGRAPHY']});
 actions.push({id:'validate-exposure',title:'Validate exposure inputs',reason:'Confirm the active fire front, fuels, moisture and local access data before requesting arrival times or evacuation margins [FORECAST, GAPS, GEOGRAPHY].',evidenceIds:['FORECAST','GAPS','GEOGRAPHY']});
 const headline=priority==='escalating'?'Thermal evidence coincides with adverse forecast weather':recent.length?'Recent thermal detections require verification':risky.length?'Concurrent fire-weather conditions require review':dryHours.length?'Extremely dry fine fuels require inspection':degraded?'Evidence gaps limit this assessment':'Continue monitoring; no configured trigger met';
 const exposureText=a.exposure?.uplift?` Nearby people and infrastructure add ${a.exposure.uplift}/40 review-priority points [EXPOSURE].`:'';
 const briefing=`${headline}${exposureText} [${recent.length?'THERMAL, ':''}${risky.length?'RULE, PEAK':dryHours.length?'DRYNESS':degraded?'COVERAGE, WEATHER':'RULE, WEATHER, THERMAL'}]. ${recent.length&&risky.length?'Co-occurrence is a review trigger, not confirmation of a spreading wildfire [RULE, THERMAL]. ':''}Physical fire arrival and evacuation margins remain unavailable [FORECAST, GAPS]. Rules-based decision support; human validation required [RULE].`;
 return{headline,priority,briefing,evidence,actions,weatherWindows,limitations:[`Rules-based triage is uncalibrated; absence of a trigger does not establish safety [RULE].`,`Thermal detections may have non-fire causes, and satellite coverage is intermittent [THERMAL].`,`Mapped features have unknown completeness and occupancy; building height does not establish vulnerability [GEOGRAPHY].`,`Fire spread and evacuation estimates are withheld pending required inputs [FORECAST, GAPS].`,...(!complete?[`Incomplete weather coverage limits comparison across the next 24 hours [WEATHER].`]:[])]};
}
