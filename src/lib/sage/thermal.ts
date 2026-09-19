import type {Hotspot} from '../providers/types';
import type {FeatureCollection} from 'geojson';
import {contains,localPolygons,toLocal} from './geometry';
import type {XY} from './types';
export type ThermalTrack={id:string;position:XY;first:string;last:string;days:number;passes:number;peakMw:number|null;trendMw:number|null;priority:'review'|'watch';reasons:string[];history:{time:string;mw:number|null}[]};
export function thermalTracks(hotspots:Hotspot[],center:XY,weather:{windKmh:number;humidityPct:number}|null,now=Date.now(),landcover?:FeatureCollection):ThermalTrack[]{
 const seen=new Map(hotspots.filter(h=>Number.isFinite(Date.parse(h.provenance.observedAt))&&Date.parse(h.provenance.observedAt)<=now+60000&&now-Date.parse(h.provenance.observedAt)<=30*86400000).map(h=>[h.id,h]));
 const groups:Hotspot[][]=[];
 for(const h of [...seen.values()].sort((a,b)=>a.provenance.observedAt.localeCompare(b.provenance.observedAt))){const p=toLocal(h.position,center);if(Math.hypot(...p)>10000)continue;const group=groups.find(g=>{const q=toLocal(g[0].position,center);return Math.hypot(p[0]-q[0],p[1]-q[1])<=500;});if(group)group.push(h);else groups.push([h]);}
 return groups.map(g=>{
  const passes=new Map<string,number|null>();for(const h of g){const time=h.provenance.observedAt,previous=passes.get(time);passes.set(time,h.frpMw===null?previous??null:Math.max(previous??0,h.frpMw));}
  const history=[...passes].map(([time,mw])=>({time,mw})).sort((a,b)=>a.time.localeCompare(b.time));
  const days=new Set(history.map(p=>p.time.slice(0,10))).size,first=history[0],last=history.at(-1)!;
  const trend=history.length>1&&first.mw!==null&&last.mw!==null?last.mw-first.mw:null,recent=now-Date.parse(last.time)<=6*3600000,adverse=!!weather&&weather.windKmh>=25&&weather.humidityPct<=25;
  const cover=landcover?.features.find(f=>(f.geometry.type==='Polygon'||f.geometry.type==='MultiPolygon')&&contains([0,0],localPolygons(f.geometry,g[0].position)));
  const coverName=String(cover?.properties?.landuse||cover?.properties?.natural||cover?.properties?.categoria||'');
  const reasons=[...(coverName?[`Mapped cover: ${coverName}`]:['Land cover unknown']),days>=3?'Recurring location · cause unverified':'Limited recurrence history',...(trend!==null&&trend>0?['Peak FRP increased']:[]),...(adverse?['Dry / windy weather']:[]),...(!weather?['Weather unavailable']:[]),...(!recent?['No detection in past 6h']:[])];
  const values=history.flatMap(p=>p.mw===null?[]:[p.mw]);
  return {id:g[0].id,position:g[0].position,first:first.time,last:last.time,days,passes:history.length,peakMw:values.length?Math.max(...values):null,trendMw:trend,priority:recent&&(adverse||(trend!==null&&trend>0))?'review' as const:'watch' as const,reasons,history};
 }).sort((a,b)=>(a.priority==='review'?0:1)-(b.priority==='review'?0:1)||b.last.localeCompare(a.last)).slice(0,100);
}
