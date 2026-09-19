import type {FeatureCollection, Polygon} from 'geojson';
import type {RunResult, XY} from './types';
import {toLocal, toLonLat} from './geometry';

/** Illustration only: no emissions inventory, vertical atmosphere or concentration. */
export const SMOKE_ASSUMPTIONS = {surfaceResidenceMin:10, structuralResidenceMin:30, puffLifetimeMin:30, releaseStepMin:2, maxSources:96, diffusivityM2s:8} as const;
const degrees = (n:number) => ((n%360)+360)%360;
const radians = Math.PI/180;
const finite = (n:unknown):n is number => typeof n==='number' && Number.isFinite(n);
export function compass(deg:number) {return ['N','NE','E','SE','S','SW','W','NW'][Math.round(degrees(deg)/45)%8];}
export function windAt(run:RunResult, minute:number) {
  const t=Date.parse(run.forecastOrigin)+minute*60000;
  const w=run.weather.find(w=>Date.parse(w.time)<=t && t<Date.parse(w.time)+3600000);
  if(!w || !finite(w.windKmh) || !finite(w.windFromDegrees))return null;
  const e=run.request.experiment;
  const shifted=e && t>=Date.parse(e.windOrigin||run.forecastOrigin)+e.windShiftMinutes*60000;
  const speedKmh=Math.max(0,w.windKmh*(shifted?e.windFactor:1));
  const fromDegrees=degrees(w.windFromDegrees+(shifted?e.windOffset:0));
  return {speedKmh,fromDegrees,toDegrees:degrees(fromDegrees+180)};
}
/** Sutherland-Hodgman clipping; return a closed, positive-area ring or no ring. */
export function clipPuffToDomain(position:XY,radius:number,half:number):XY[] {
  let ring:XY[]=Array.from({length:24},(_,i)=>[position[0]+radius*Math.cos(i/24*Math.PI*2),position[1]+radius*Math.sin(i/24*Math.PI*2)]);
  for(const [axis,bound,sign] of [[0,-half,1],[0,half,-1],[1,-half,1],[1,half,-1]]){
    const input=ring;ring=[];if(!input.length)return [];
    let previous=input[input.length-1],previousInside=(previous[axis]-bound)*sign>=0;
    for(const current of input){const inside=(current[axis]-bound)*sign>=0;
      if(inside!==previousInside){const fraction=(bound-previous[axis])/(current[axis]-previous[axis]);ring.push([previous[0]+fraction*(current[0]-previous[0]),previous[1]+fraction*(current[1]-previous[1])]);}
      if(inside)ring.push(current);previous=current;previousInside=inside;
    }
  }
  ring=ring.filter((point,i)=>i===0||Math.hypot(point[0]-ring[i-1][0],point[1]-ring[i-1][1])>1e-8);
  const twiceArea=Math.abs(ring.reduce((sum,p,i)=>{const q=ring[(i+1)%ring.length];return sum+p[0]*q[1]-q[0]*p[1];},0));
  if(ring.length<3||twiceArea<1e-6)return [];
  return [...ring,ring[0]];
}
function cellCenter(polygon:Polygon,center:XY):XY {const ring=polygon.coordinates[0].slice(0,-1);return toLocal([ring.reduce((s,p)=>s+p[0],0)/ring.length,ring.reduce((s,p)=>s+p[1],0)/ring.length],center);}
/** Piecewise midpoint integration splits at forecast-hour and experiment boundaries. */
export function advectPuff(run:RunResult,position:XY,release:number,minute:number):XY|null {
  let [x,y]=position,t=release;
  const origin=Date.parse(run.forecastOrigin);
  const shift=run.request.experiment? (Date.parse(run.request.experiment.windOrigin||run.forecastOrigin)-origin)/60000+run.request.experiment.windShiftMinutes:Infinity;
  while(t<minute) {
    let end=Math.min(minute,t+1);
    for(const w of run.weather){const boundary=(Date.parse(w.time)-origin)/60000;if(boundary>t+1e-9)end=Math.min(end,boundary);}
    if(shift>t+1e-9)end=Math.min(end,shift);
    const wind=windAt(run,(t+end)/2);if(!wind)return null;
    const distance=wind.speedKmh*1000/60*(end-t),angle=wind.toDegrees*radians;
    x+=Math.sin(angle)*distance;y+=Math.cos(angle)*distance;t=end;
  }
  return [x,y];
}
export function smokeIllustration(run:RunResult,requestedMinute:number, includePlumes=true) {
  const minute=Math.max(0,Math.min(run.request.horizonMinutes,finite(requestedMinute)?requestedMinute:0));
  const wind=windAt(run,minute),half=run.size*run.cellM/2;
  const sources:Array<{position:XY;arrival:number;residence:number;kind:string}>=[];
  const windows=[{x:0,y:0,count:0},{x:0,y:0,count:0}];
  for(const f of run.cells.features){const arrival=f.properties?.arrivalCentral;if(!finite(arrival)||arrival>minute)continue;
    const position=cellCenter(f.geometry,run.center);
    if(arrival>Math.max(0,minute-10)){const window=windows[arrival<=minute-5?0:1];window.x+=position[0];window.y+=position[1];window.count++;}
    if(arrival+SMOKE_ASSUMPTIONS.surfaceResidenceMin+SMOKE_ASSUMPTIONS.puffLifetimeMin>minute)sources.push({position,arrival,residence:SMOKE_ASSUMPTIONS.surfaceResidenceMin,kind:'surface'});
  }
  for(const b of run.buildings){const arrival=b.structuralIgnitionByMember?.[0];if(finite(arrival)&&arrival<=minute&&arrival+SMOKE_ASSUMPTIONS.structuralResidenceMin+SMOKE_ASSUMPTIONS.puffLifetimeMin>minute)sources.push({position:toLocal(b.center,run.center),arrival,residence:SMOKE_ASSUMPTIONS.structuralResidenceMin,kind:'assumed-structure'});}
  const plumes:FeatureCollection<Polygon>={type:'FeatureCollection',features:[]};
  const stride=Math.max(1,Math.ceil(sources.length/SMOKE_ASSUMPTIONS.maxSources));
  for(let index=0;includePlumes&&index<sources.length;index+=stride){const source=sources[index];
    for(let release=source.arrival;release<source.arrival+source.residence&&release<=minute;release+=SMOKE_ASSUMPTIONS.releaseStepMin){const age=minute-release;if(age>=SMOKE_ASSUMPTIONS.puffLifetimeMin)continue;
      const position=advectPuff(run,source.position,release,minute);if(!position)continue;
      const radius=Math.sqrt((run.cellM/2)**2+2*SMOKE_ASSUMPTIONS.diffusivityM2s*age*60);
      if(Math.abs(position[0])>half+radius||Math.abs(position[1])>half+radius)continue;
      const clipped=clipPuffToDomain(position,radius,half);if(!clipped.length)continue;
      const ring=clipped.map(point=>toLonLat(point,run.center));
      plumes.features.push({type:'Feature',geometry:{type:'Polygon',coordinates:[ring]},properties:{kind:source.kind,ageMinutes:age,radiusM:radius,opacity:.035+.065*(1-age/SMOKE_ASSUMPTIONS.puffLifetimeMin)}});
    }
  }
  let heading:number|null=null;
  if(minute>=10&&windows.every(window=>window.count>=3)){
    const dx=windows[1].x/windows[1].count-windows[0].x/windows[0].count,dy=windows[1].y/windows[1].count-windows[0].y/windows[0].count;
    if(Math.hypot(dx,dy)>=run.cellM)heading=degrees(Math.atan2(dx,dy)/radians);
  }
  return {minute,wind,fireHeadingDegrees:heading,plumes,sampledSources:Math.ceil(sources.length/stride),eligibleSources:sources.length};
}
