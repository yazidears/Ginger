import type {Assessment} from './assessment';
import type {OperationsState} from './operations';
export type PositionFix={lat:number;lon:number;accuracyM:number;observedAt:string;source:'ios-core-location'};
export function validateFix(value:unknown,lat:number,lon:number,now=Date.now()):PositionFix {
  if(!value||typeof value!=='object')throw Error('GPS position required.');
  const f=value as PositionFix;const age=now-Date.parse(f.observedAt);
  if(f.source!=='ios-core-location'||f.lat!==lat||f.lon!==lon||!Number.isFinite(f.lat)||Math.abs(f.lat)>90||!Number.isFinite(f.lon)||Math.abs(f.lon)>180||!Number.isFinite(f.accuracyM)||f.accuracyM<0||f.accuracyM>1000||!Number.isFinite(age)||age< -5000||age>60000)throw Error('GPS position is stale, inaccurate or invalid. Obtain a fresh fix.');
  return {lat,lon,accuracyM:f.accuracyM,observedAt:f.observedAt,source:'ios-core-location'};
}
function distance(lat:number,lon:number,lat2:number,lon2:number){const r=Math.PI/180;const dlat=(lat2-lat)*r,dlon=(lon2-lon)*r;const a=Math.sin(dlat/2)**2+Math.cos(lat*r)*Math.cos(lat2*r)*Math.sin(dlon/2)**2;return 6371000*2*Math.atan2(Math.sqrt(a),Math.sqrt(Math.max(0,1-a)));}
export function buildSituation(a:Assessment,operations:OperationsState|null,now=Date.now()) {
  const {lat,lon}=a.location;
  const nearby=(p:{lat:number;lon:number})=>distance(lat,lon,p.lat,p.lon);
  const observations=(operations?.observations??[]).filter(o=>now-Date.parse(o.createdAt)>=0&&now-Date.parse(o.createdAt)<=86400000).map(o=>({...o,distanceM:Math.round(nearby(o.location))})).filter(o=>o.distanceM<=10000).sort((a,b)=>a.distanceM-b.distanceM).slice(0,10);
  const tasks=(operations?.tasks??[]).filter(t=>t.status!=='completed').map(t=>({...t,distanceM:Math.round(nearby(t.location))})).filter(t=>t.distanceM<=10000).sort((a,b)=>a.distanceM-b.distanceM).slice(0,10);
  return {dgps:{available:false,reason:'No differential correction feed or validated DGPS receiver is connected to Ginger.'},operationsAvailable:operations!==null,observations,tasks,scope:'Within 10 km; observations from the past 24 hours. Operator entries are unverified. Distances are straight-line, not routes.'};
}
