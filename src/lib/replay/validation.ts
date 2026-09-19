import {validatePolygon} from '../sage/investigation';
import {localPolygons} from '../sage/geometry';
import type {ReplayCase} from './types';

const text=(v:unknown)=>typeof v==='string'&&v.trim().length>=3&&v.length<=500;
const timestamp=(v:unknown)=>typeof v==='string'&&/Z$|[+-]\d\d:\d\d$/.test(v)&&Number.isFinite(Date.parse(v));
export function validateReplayCase(input:unknown):ReplayCase {
  const c=input as ReplayCase;
  if(!c||c.version!==1||!text(c.id)||!text(c.name)||!text(c.eventId)||!['synthetic','historical'].includes(c.kind)||!['train','validation','test'].includes(c.split))throw Error('Replay requires version 1, name, case/event IDs, kind and split.');
  if(!timestamp(c.origin)||Date.parse(c.origin)>=Date.now())throw Error('Replay origin must be a past timestamp with timezone.');
  const p=c.provenance,origin=Date.parse(c.origin);
  if(!p||![p.weatherSource,p.landscapeSource].every(text)||!timestamp(p.landscapeValidAt)||Date.parse(p.landscapeValidAt)>origin||!timestamp(p.weatherIssuedAt))throw Error('Supply dated weather and pre-event landscape provenance.');
  if(!['synthetic','archived-forecast','observation','reanalysis'].includes(p.weatherKind)||c.kind==='historical'&&p.weatherKind==='synthetic')throw Error('Historical cases cannot use synthetic weather.');
  if(p.weatherKind==='archived-forecast'&&Date.parse(p.weatherIssuedAt)>origin)throw Error('Forecast weather must have been issued at or before replay origin.');
  const l=c.landscape,r=c.request;
  if(!l||!Number.isInteger(l.size)||l.size<8||l.size>80||!Number.isFinite(l.cellM)||l.cellM<10||l.cellM>100||l.size*l.cellM>4000)throw Error('Use an 8–80 cell square grid, 10–100 m cells, at most 4 km across.');
  if(!Array.isArray(l.center)||l.center.length!==2||!l.center.every(Number.isFinite)||Math.abs(l.center[0])>180||Math.abs(l.center[1])>80||!Array.isArray(l.elevations)||l.elevations.length!==l.size*l.size||!l.elevations.every(Number.isFinite))throw Error('Complete, finite terrain and valid coordinates required.');
  if(!r||r.lat!==l.center[1]||r.lon!==l.center[0]||r.structural||r.mode!=='scenario'||![60,120,240].includes(r.horizonMinutes))throw Error('Replay requires a matching surface-only scenario with a 60, 120 or 240 minute horizon.');
  if(![r.deadMoisturePct,r.liveMoisturePct,r.ignitionRadiusM,r.windAdjustment].every(Number.isFinite)||r.deadMoisturePct<1||r.deadMoisturePct>50||r.liveMoisturePct<1||r.liveMoisturePct>300||r.ignitionRadiusM<=0||r.ignitionRadiusM>200||r.windAdjustment<0||r.windAdjustment>1||typeof r.solarDrying!=='boolean'||r.grassModel&& !['rothermel','ginger-o2'].includes(r.grassModel))throw Error('Invalid moisture, ignition, wind or grass-model inputs.');
  const e=r.experiment,initial=e?.observation;
  if(!e||!initial||initial.observedAt!==c.origin||!text(initial.source)||e.windOffset!==0||e.windFactor!==1||e.windShiftMinutes!==0||e.windOrigin&&e.windOrigin!==c.origin||e.fuelBreak||!Array.isArray(e.ignitionOffset)||e.ignitionOffset.length!==2||e.ignitionOffset.some(v=>v!==0))throw Error('Supply a sourced initial perimeter at origin; replay input must not contain scenario interventions.');
  const half=l.size*l.cellM/2;
  const polygon=(g:unknown)=>{const geometry=validatePolygon(g);if(localPolygons(geometry,l.center).flat(2).some(p=>Math.abs(p[0])>half+.01||Math.abs(p[1])>half+.01))throw Error('Observed perimeter must fit completely inside the evaluation domain.');};
  polygon(initial.geometry);
  if(!Array.isArray(c.observations)||c.observations.length<2||c.observations.length>16)throw Error('Supply 2–16 later, independently sourced cumulative burned-area perimeters.');
  let prior=origin;
  for(const o of c.observations){
    if(!timestamp(o.at)||Date.parse(o.at)<=prior||Date.parse(o.at)>origin+r.horizonMinutes*60000||!timestamp(o.availableAt)||Date.parse(o.availableAt)<Date.parse(o.at)||!text(o.source)||!Number.isFinite(o.uncertaintyM)||o.uncertaintyM<0||o.uncertaintyM>500)throw Error('Observations must be chronological, within the horizon, sourced, with valid availability time and 0–500 m uncertainty.');
    polygon(o.geometry);prior=Date.parse(o.at);
  }
  for(const collection of [l.landcover,l.buildings]){
    if(collection?.type!=='FeatureCollection'||!Array.isArray(collection.features)||collection.features.length>500)throw Error('Limit each landscape collection to 500 polygon features.');
    let vertices=0;
    for(const f of collection.features){
      if(f.geometry?.type!=='Polygon'&&f.geometry?.type!=='MultiPolygon')throw Error('Landscape features must be polygonal.');
      const parts=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;
      for(const rings of parts){validatePolygon({type:'Polygon',coordinates:rings});vertices+=rings.flat().length;}
      if(vertices>15000)throw Error('Landscape geometry exceeds 15,000 vertices.');
    }
  }
  if(!Array.isArray(l.weather)||l.weather.length<2||l.weather.length>12||!Array.isArray(l.sources)||!Array.isArray(l.warnings)||l.warnings.length>50||l.warnings.some(w=>typeof w!=='string'||w.length>1000))throw Error('Supply bounded hourly weather and source records, with text warnings.');
  for(let i=0;i<l.weather.length;i++){
    const w=l.weather[i];
    if(!timestamp(w.time)||i>0&&Date.parse(w.time)-Date.parse(l.weather[i-1].time)!==3600000||![w.temperatureC,w.humidityPct,w.windKmh,w.windFromDegrees,w.directNormalWm2,w.diffuseWm2,w.precipitationMm].every(Number.isFinite)||w.humidityPct<0||w.humidityPct>100||w.windKmh<0||w.windKmh>200||w.windFromDegrees<0||w.windFromDegrees>360||w.precipitationMm<0||w.directNormalWm2<0||w.diffuseWm2<0)throw Error('Weather must be finite, valid, contiguous hourly frames.');
  }
  if(Date.parse(l.weather[0].time)>origin||Date.parse(l.weather.at(-1)!.time)+3600000<=origin+r.horizonMinutes*60000)throw Error('Weather must cover the whole horizon, including its endpoint.');
  return c;
}
