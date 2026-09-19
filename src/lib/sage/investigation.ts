import type {Feature,FeatureCollection,Polygon,Point,LineString} from 'geojson';
import type {RunRequest,RunResult,XY} from './types';
import {cellCenter,contains,indexAt,localPolygons,toLocal,toLonLat} from './geometry';
const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);
export function validatePolygon(raw:unknown):Polygon {
  const g=raw as Polygon;
  if(!g||g.type!=='Polygon'||!Array.isArray(g.coordinates)||!g.coordinates.length||g.coordinates.length>10)throw Error('Import a GeoJSON Polygon');
  let count=0;
  for(const ring of g.coordinates){
    if(!Array.isArray(ring)||ring.length<4)throw Error('Polygon rings need at least four coordinates');
    count+=ring.length;
    if(count>500||ring.some(p=>!Array.isArray(p)||p.length<2||!finite(p[0])||!finite(p[1])||Math.abs(p[0])>180||Math.abs(p[1])>85))throw Error('Invalid polygon coordinates (maximum 500 vertices)');
    if(ring[0][0]!==ring.at(-1)![0]||ring[0][1]!==ring.at(-1)![1])throw Error('Close the polygon ring');
    const area=ring.reduce((sum,p,i)=>{const q=ring[(i+1)%ring.length];return sum+p[0]*q[1]-q[0]*p[1];},0);
    if(Math.abs(area)<1e-12)throw Error('Polygon has no area');
  }
  return g;
}
export function validateExperiment(raw:unknown):NonNullable<RunRequest['experiment']>{
  if(!raw||typeof raw!=='object')throw Error('Invalid experiment');
  const v=raw as Record<string,unknown>;
  if(typeof v.parentId!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v.parentId))throw Error('Select a saved baseline');
  const num=(key:string,min:number,max:number)=>{const n=v[key];if(!finite(n)||n<min||n>max)throw Error(`Invalid ${key}`);return n;};
  if(!Array.isArray(v.ignitionOffset)||v.ignitionOffset.length!==2||!v.ignitionOffset.every(n=>finite(n)&&Math.abs(n)<=750))throw Error('Ignition offset must be within 750 m');
  const experiment:NonNullable<RunRequest['experiment']>={parentId:v.parentId,windOffset:num('windOffset',-180,180),windFactor:num('windFactor',0,3),windShiftMinutes:num('windShiftMinutes',0,240),ignitionOffset:v.ignitionOffset as XY};
  if(experiment.windShiftMinutes%30!==0)throw Error('Wind shift uses 30-minute steps');
  if(v.fuelBreak)experiment.fuelBreak=validatePolygon(v.fuelBreak);
  if(v.observation){
    const o=v.observation as Record<string,unknown>;
    if(typeof o.observedAt!=='string'||!Number.isFinite(Date.parse(o.observedAt))||Date.parse(o.observedAt)>Date.now()+60000)throw Error('Use the actual observation time');
    if(typeof o.source!=='string'||o.source.trim().length<3||o.source.length>240)throw Error('Add a perimeter source');
    experiment.observation={geometry:validatePolygon(o.geometry),source:o.source.trim(),observedAt:new Date(o.observedAt).toISOString()};
  }
  return experiment;
}
export const emptyOverlay=():FeatureCollection=>({type:'FeatureCollection',features:[]});
function cellKey(f:Feature<Polygon>){const p=f.geometry.coordinates[0][0];return `${p[0].toFixed(7)},${p[1].toFixed(7)}`;}
function at(f:Feature<Polygon>,minute:number){return finite(f.properties?.arrivalCentral)&&f.properties!.arrivalCentral<=minute;}
export function compareRuns(before:RunResult,after:RunResult,minute:number){
  if(before.center.some((n,i)=>Math.abs(n-after.center[i])>1e-7)||before.cellM!==after.cellM||before.size!==after.size)throw Error('Compare runs on the same domain');
  const absolute=Date.parse(after.forecastOrigin)+minute*60000;
  const beforeMinute=(absolute-Date.parse(before.forecastOrigin))/60000;
  if(beforeMinute<0||beforeMinute>before.request.horizonMinutes)throw Error('Outside the shared forecast window');
  const old=new Map(before.cells.features.filter(f=>at(f,beforeMinute)).map(f=>[cellKey(f),f]));
  const next=new Map(after.cells.features.filter(f=>at(f,minute)).map(f=>[cellKey(f),f]));
  const added=[...next].filter(([k])=>!old.has(k)).map(([,f])=>({...f,properties:{...f.properties,color:'#ff7958',label:'Newly projected'}}));
  const removed=[...old].filter(([k])=>!next.has(k)).map(([,f])=>({...f,properties:{...f.properties,color:'#73cabc',label:'Previously projected'}}));
  const changed:string[]=[];
  for(const [key,label] of [['deadMoisturePct','Dead moisture'],['liveMoisturePct','Live moisture'],['windAdjustment','Midflame wind'],['ignitionRadiusM','Ignition radius'],['solarDrying','Solar drying']] as const){if(before.request[key]!==after.request[key])changed.push(`${label}: ${before.request[key]} → ${after.request[key]}`);}
  if(JSON.stringify(before.request.structural)!==JSON.stringify(after.request.structural))changed.push('Structural transfer assumptions changed');
  if((before.request.grassModel??'rothermel')!==(after.request.grassModel??'rothermel'))changed.push('Grass spread model changed');
  if(before.engine!==after.engine)changed.push('Engine version changed; differences can include solver changes');
  const a=after.request.experiment,b=before.request.experiment;
  if((a?.windOffset??0)!==(b?.windOffset??0)||(a?.windFactor??1)!==(b?.windFactor??1)||(a?.windShiftMinutes??0)!==(b?.windShiftMinutes??0))changed.push(`Wind: ×${a?.windFactor??1}, ${a?.windOffset??0}° from +${a?.windShiftMinutes??0}m`);
  if(JSON.stringify(a?.ignitionOffset??[0,0])!==JSON.stringify(b?.ignitionOffset??[0,0]))changed.push('Ignition moved');
  if(JSON.stringify(a?.fuelBreak)!==JSON.stringify(b?.fuelBreak))changed.push('Fuel removal changed');
  if(JSON.stringify(a?.observation)!==JSON.stringify(b?.observation))changed.push('Observed extent updated');
  if(JSON.stringify(before.weather)!==JSON.stringify(after.weather))changed.push('Weather forcing refreshed');
  if(before.forecastOrigin!==after.forecastOrigin)changed.push('Forecast origin changed');
  const newlyExposed=after.buildings.filter(x=>x.arrivalMin!==null&&x.arrivalMin<=minute&&!before.buildings.some(y=>y.id===x.id&&y.arrivalMin!==null&&y.arrivalMin<=beforeMinute));
  return {addedHa:added.length*after.cellM**2/10000,removedHa:removed.length*after.cellM**2/10000,newlyExposed,changed,overlay:{type:'FeatureCollection',features:[...removed,...added]} as FeatureCollection};
}
export function sensitivity(run:RunResult){
  // These are finite scenario differences, not probabilities or formal expected information gain.
  const central=new Set(run.buildings.filter(b=>b.arrivalByMember[0]!==null).map(b=>b.id));
  const members=run.members.slice(1).map((m,j)=>{
    const i=j+1;let changed=0,shift=0;
    for(const b of run.buildings){const a=b.arrivalByMember[0],v=b.arrivalByMember[i];if(central.has(b.id)!==(v!==null))changed++;if(a!==null&&v!==null)shift=Math.max(shift,Math.abs(v-a));}
    return {name:m.name,index:i,changed,maxShift:shift,score:changed*run.request.horizonMinutes+shift};
  }).filter(m=>!(run.members[m.index].windFactor!==1&&run.members[m.index].moistureOffset!==0)).sort((a,b)=>b.score-a.score);
  const cells=run.cells.features.map(f=>{
    const times=f.properties?.arrivalByMember as (number|null)[]|undefined;
    const valid=times?.filter((x):x is number=>finite(x))??[];
    const spread=valid.length?Math.max(...valid)-Math.min(...valid):0;
    const disagreement=times?times.filter(x=>x===null).length:0;
    return {f,spread,disagreement,score:disagreement*run.request.horizonMinutes+spread};
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
  const picks:typeof cells=[];
  for(const c of cells){const pos=toLocal(c.f.geometry.coordinates[0][0],run.center);if(picks.every(p=>{const q=toLocal(p.f.geometry.coordinates[0][0],run.center);return Math.hypot(pos[0]-q[0],pos[1]-q[1])>=150;}))picks.push(c);if(picks.length===3)break;}
  return {members,targets:picks.map(c=>({position:toLonLat(toLocal(c.f.geometry.coordinates[0][0],run.center).map(n=>n+run.cellM/2) as XY,run.center),spread:c.spread,disagreement:c.disagreement})),overlay:{type:'FeatureCollection',features:cells.map(c=>({...c.f,properties:{color:c.disagreement?'#c79ce8':'#e6bd6c',label:`${c.spread.toFixed(0)} min spread · ${c.disagreement} non-reaching members`}}))} as FeatureCollection};
}
export function perimeterFit(run:RunResult,polygon:Polygon,observedAt:string){
  const minute=(Date.parse(observedAt)-Date.parse(run.forecastOrigin))/60000;
  if(!Number.isFinite(minute)||minute<0||minute>run.request.horizonMinutes)throw Error('Observation must fall within this forecast');
  const parts=localPolygons(validatePolygon(polygon),run.center),half=run.size*run.cellM/2;
  if(parts.flat(2).some(p=>Math.abs(p[0])>half||Math.abs(p[1])>half))throw Error('Perimeter extends beyond this domain');
  const predicted=new Set(run.cells.features.filter(f=>at(f,minute)).map(f=>indexAt(toLocal(f.geometry.coordinates[0][0],run.center).map(n=>n+run.cellM/2) as XY,run.size,run.cellM)));
  let intersection=0,observed=0,union=predicted.size;
  for(let i=0;i<run.size**2;i++)if(contains(cellCenter(i,run.size,run.cellM),parts)){observed++;if(predicted.has(i))intersection++;else union++;}
  if(!observed)throw Error('Perimeter is smaller than the model grid');
  return {minute,overlap:union?intersection/union:0,missedHa:(observed-intersection)*run.cellM**2/10000,extraHa:(predicted.size-intersection)*run.cellM**2/10000};
}
export type Dependency = Feature<Point|LineString|Polygon,{name:string;group:string;kind:string;source:string;verifiedAt:string}>;
export function validateDependencies(raw:unknown):FeatureCollection<Dependency['geometry'],Dependency['properties']>{
  const fc=raw as FeatureCollection<Dependency['geometry'],Dependency['properties']>;
  if(fc?.type!=='FeatureCollection'||!Array.isArray(fc.features)||fc.features.length>100)throw Error('Import up to 100 GeoJSON assets');
  for(const f of fc.features){
    const p=f.properties,g=f.geometry;
    if(!p||['name','group','kind','source','verifiedAt'].some(k=>typeof p[k as keyof typeof p]!=='string'||!p[k as keyof typeof p].trim()||p[k as keyof typeof p].length>240)||!Number.isFinite(Date.parse(p.verifiedAt))||Date.parse(p.verifiedAt)>Date.now()+60000)throw Error('Each asset needs name, group, kind, source and verifiedAt');
    if(g?.type==='Polygon')validatePolygon(g);
    else if(g?.type==='Point'||g?.type==='LineString'){
      const coords=g.type==='Point'?[g.coordinates]:g.coordinates;
      if(!coords.length||coords.length>500||(g.type==='LineString'&&coords.length<2)||coords.some(p=>p.length<2||!finite(p[0])||!finite(p[1])||Math.abs(p[0])>180||Math.abs(p[1])>85))throw Error('Invalid asset coordinates');
    }else throw Error('Use Point, LineString or Polygon assets');
  }
  return fc;
}
export function compoundExposure(run:RunResult,assets:ReturnType<typeof validateDependencies>,minute:number){
  const reached=new Set(run.cells.features.filter(f=>at(f,minute)).map(f=>indexAt(toLocal(f.geometry.coordinates[0][0],run.center).map(n=>n+run.cellM/2) as XY,run.size,run.cellM)));
  const rows=assets.features.map(f=>{
    const cells=new Set<number>();const g=f.geometry;
    if(g.type==='Point')cells.add(indexAt(toLocal(g.coordinates,run.center),run.size,run.cellM));
    if(g.type==='LineString')for(let i=1;i<g.coordinates.length;i++){
      const a=toLocal(g.coordinates[i-1],run.center),b=toLocal(g.coordinates[i],run.center),steps=Math.min(10000,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/(run.cellM/4)));
      for(let j=0;j<=steps;j++)cells.add(indexAt([a[0]+(b[0]-a[0])*j/(steps||1),a[1]+(b[1]-a[1])*j/(steps||1)],run.size,run.cellM));
    }
    if(g.type==='Polygon'){const parts=localPolygons(g,run.center);for(let i=0;i<run.size**2;i++)if(contains(cellCenter(i,run.size,run.cellM),parts))cells.add(i);if(parts.flat(2).some(p=>indexAt(p,run.size,run.cellM)<0))cells.add(-1);}
    const exposed=[...cells].some(i=>reached.has(i)),partial=cells.has(-1)||!cells.size;
    return {...f.properties,exposed,partial};
  });
  const groups=[...new Set(rows.map(r=>r.group))].map(name=>({name,assets:rows.filter(r=>r.group===name),exposedKinds:[...new Set(rows.filter(r=>r.group===name&&r.exposed).map(r=>r.kind))]}));
  return {groups,overlay:{type:'FeatureCollection',features:assets.features.map((f,i)=>({...f,properties:{...f.properties,color:rows[i].exposed?'#ff7958':'#73cabc'}}))} as FeatureCollection};
}
