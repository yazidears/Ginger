import type {FeatureCollection} from 'geojson';
export type SensorPass={source:string;time:string;count:number;frpMw:number|null;thermalContrastK:number|null};
export type SatelliteArchive={observations:FeatureCollection;perimeters:FeatureCollection;passes:SensorPass[];sources:{name:string;status:'live'|'unavailable';detail:string}[];start:string;end:string;retrievedAt:string;bounds:[number,number,number,number]};
export function numeric(value:unknown):number|null {if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isFinite(n)?n:null;}
/** Same source and acquisition minute only; never sum different overpasses as simultaneous power. */
export function sensorPasses(observations:FeatureCollection):SensorPass[]{
 const groups=new Map<string,{source:string;time:string;count:number;frp:number[];contrast:number[]}>();
 for(const f of observations.features){const p=f.properties||{},stamp=Date.parse(String(p.observed_at));if(!Number.isFinite(stamp))continue;const source=String(p.source||'Unknown sensor'),time=new Date(Math.floor(stamp/60000)*60000).toISOString(),key=source+time;
 const g=groups.get(key)||{source,time,count:0,frp:[],contrast:[]};g.count++;const frp=numeric(p.fire_radiative_power??p.frp);if(frp!==null&&frp>=0)g.frp.push(frp);
 const i4=numeric(p.bright_ti4),i5=numeric(p.bright_ti5);if(i4!==null&&i5!==null&&i4>0&&i5>0)g.contrast.push(i4-i5);groups.set(key,g);}
 return [...groups.values()].map(g=>({source:g.source,time:g.time,count:g.count,frpMw:g.frp.length?g.frp.reduce((a,b)=>a+b,0):null,thermalContrastK:g.contrast.length?g.contrast.reduce((a,b)=>a+b,0)/g.contrast.length:null})).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
}
/** Latest available estimate for each cluster at the selected time; old snapshots are not unioned. */
export function perimeterFrame(history:FeatureCollection,at:number):FeatureCollection{
 const latest=new Map<string,FeatureCollection['features'][number]>();
 for(const f of history.features){const p=f.properties||{},time=Date.parse(String(p.computed_at));if(!Number.isFinite(time)||time>at||!p.cluster_id)continue;const key=String(p.cluster_id),prior=latest.get(key);if(!prior||Date.parse(String(prior.properties?.computed_at))<time)latest.set(key,f);}
 return {type:'FeatureCollection',features:[...latest.values()]};
}
export function parseLabQuery(params:URLSearchParams){
 const lat=Number(params.get('lat')),lon=Number(params.get('lon')),days=Number(params.get('days')||3);
 if(!params.get('lat')?.trim()||!params.get('lon')?.trim()||![lat,lon,days].every(Number.isFinite)||Math.abs(lat)>85||Math.abs(lon)>180||!Number.isInteger(days)||days<1||days>7)throw Error('Use latitude −85…85, longitude −180…180 and 1–7 days.');
 return {lat,lon,days};
}
export function parseSpreadInput(v:unknown){
 if(!v||typeof v!=='object')throw Error('Invalid simulation settings');
 const p=v as Record<string,unknown>,{latitude,longitude,durationHours,model,ensembleMembers}=p;
 if(typeof latitude!=='number'||!Number.isFinite(latitude)||Math.abs(latitude)>85||typeof longitude!=='number'||!Number.isFinite(longitude)||Math.abs(longitude)>180||typeof durationHours!=='number'||!Number.isInteger(durationHours)||durationHours<1||durationHours>24||!['elmfire','forefire'].includes(String(model))||typeof ensembleMembers!=='number'||!Number.isInteger(ensembleMembers)||ensembleMembers<1||ensembleMembers>50)throw Error('Invalid simulation settings');
 return {latitude,longitude,durationHours,model:model as 'elmfire'|'forefire',ensembleMembers};
}
