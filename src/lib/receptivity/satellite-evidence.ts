import type {Fuel,GridCell} from './types';
import type {Hotspot} from '../providers/types';
import type {Heatwave} from './heatwave';
import {regionalHotspots} from '../providers/satellite';
import type {Bounds} from '../providers/deepfire';
export type SatelliteEvidence={status:'live'|'stale'|'unavailable';source:string;retrievedAt:string|null;detail:string;observations:Hotspot[]};
export type CellEvidence={priority:'urgent'|'review'|'routine'|'unknown';reasons:string[];heatwaveId:string;thermalCount:number;nearestThermalKm:number|null;vegetation:'dry-signal'|'available'|'stale'|'unavailable'};
export function freshThermal(observations:Hotspot[],now=Date.now()){
 return [...new Map(observations.filter(h=>h.provenance.mode==='live'&&h.position.every(Number.isFinite)&&Math.abs(h.position[0])<=180&&Math.abs(h.position[1])<=90&&now-Date.parse(h.provenance.observedAt)>=0&&now-Date.parse(h.provenance.observedAt)<=6*3600000).map(h=>[h.id,h])).values()];
}
export async function loadSatelliteEvidence(bounds:Bounds):Promise<SatelliteEvidence>{
 // Include detections just outside the map that can affect edge cells within 5 km.
 const dy=5/110,dx=dy/Math.cos(Math.max(Math.abs(bounds[1]),Math.abs(bounds[3]))*Math.PI/180),expanded:Bounds=[Math.max(-180,bounds[0]-dx),Math.max(-90,bounds[1]-dy),Math.min(180,bounds[2]+dx),Math.min(90,bounds[3]+dy)];
 try{const r=await regionalHotspots(expanded);return {status:r.status==='live'?'live':r.status==='stale'?'stale':'unavailable',source:r.source,retrievedAt:r.updatedAt,detail:r.detail,observations:r.status==='live'?r.data:[]};}
 catch{return {status:'unavailable',source:'Satellite detections',retrievedAt:null,detail:'DeepFire and the regional FIRMS fallback are unavailable. No clear coverage is inferred.',observations:[]};}
}
export function vegetationSignal(fuel:Fuel,now=Date.now()):CellEvidence['vegetation']{
 if(typeof fuel.ndmi!=='number'||!Number.isFinite(fuel.ndmi)||Math.abs(fuel.ndmi)>1||typeof fuel.ndvi!=='number'||!Number.isFinite(fuel.ndvi)||Math.abs(fuel.ndvi)>1||!Number.isFinite(fuel.satelliteCoverage)||fuel.satelliteCoverage!<.5||fuel.satelliteCoverage!>1)return 'unavailable';
 const age=now-Date.parse(fuel.satelliteAt||'');if(!Number.isFinite(age)||age<0||age>10*86400000)return 'stale';
 return fuel.ndmi<0&&fuel.ndvi>=.3?'dry-signal':'available';
}
function distance(a:number[],b:number[]){const p=Math.PI/180,x=Math.sin((b[1]-a[1])*p/2)**2+Math.cos(a[1]*p)*Math.cos(b[1]*p)*Math.sin((b[0]-a[0])*p/2)**2;return 6371*2*Math.atan2(Math.sqrt(x),Math.sqrt(Math.max(0,1-x)));}
/** Evidence changes investigation priority, never the physical FFMC moisture state. */
export function assessCellEvidence(cell:GridCell,receptivity:number|null,heat:Heatwave,satellite:SatelliteEvidence,now=Date.now()):CellEvidence{
 const feedFresh=satellite.status==='live'&&now-Date.parse(satellite.retrievedAt||'')>=0&&now-Date.parse(satellite.retrievedAt||'')<=30*60000;
 const distances=feedFresh?freshThermal(satellite.observations,now).map(h=>distance(cell.center,h.position)).filter(d=>d<=5):[];
 const nearest=distances.length?Math.min(...distances):null,vegetation=vegetationSignal(cell.fuel,now),reasons:string[]=[];
 const heatFresh=now-Date.parse(heat.retrievedAt||'')>=0&&now-Date.parse(heat.retrievedAt||'')<=2*3600000;
 if(nearest!==null)reasons.push(`${distances.length} satellite thermal observations within 5 km; nearest ${nearest.toFixed(1)} km. Verify the source.`);
 if(heatFresh&&(heat.status==='ongoing'||heat.status==='forecast'))reasons.push(`${heat.status==='ongoing'?'Ongoing modelled':'Forecast'} heatwave: at least 3 days above ${heat.thresholdC}°C.`);
 if(vegetation==='dry-signal'&&receptivity!==null&&receptivity>=65)reasons.push('Low Sentinel-2 NDMI in vegetated pixels coincides with high weather-based receptivity. Inspect local fuels.');
 const priority=nearest!==null&&nearest<=1&&receptivity!==null&&receptivity>=65?'urgent':reasons.length?'review':!feedFresh||!heatFresh||['unavailable','incomplete'].includes(heat.status)||receptivity===null?'unknown':'routine';
 return {priority,reasons,heatwaveId:heat.id,thermalCount:distances.length,nearestThermalKm:nearest===null?null:Math.round(nearest*10)/10,vegetation};
}
