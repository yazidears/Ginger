import type {FeatureCollection,Point,Polygon,MultiPolygon} from 'geojson';
import type {FireDetectionProvider,ProviderResult,Hotspot,FireCluster} from './types';
import {cached,fetchJSON,isoNow,validSecret} from './http';
const BASE='https://api.deepfire.co';
export type Bounds=[number,number,number,number];
let tokenEntry:{token:string;clientId:string;secret:string;expiresAt:number}|undefined;
const CATALONIA:Bounds=[0.1,40.4,3.4,42.9];
export function deepfireConfigured(){return Boolean(process.env.DEEPFIRE_TOKEN?.trim()||(process.env.DEEPFIRE_CLIENT_ID?.trim()&&process.env.DEEPFIRE_CLIENT_SECRET?.trim()));}
type Properties=Record<string,unknown>;
const validTime=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&Date.parse(v)<=Date.now()+300000;
export function polygonCollection(raw:unknown):FeatureCollection<Polygon|MultiPolygon,Properties>{
 const c=raw as FeatureCollection<Polygon|MultiPolygon,Properties>;
 if(!c||c.type!=='FeatureCollection'||!Array.isArray(c.features))throw Error('Invalid Deepfire polygon collection');
 const ring=(r:unknown)=>Array.isArray(r)&&r.length>=4&&r.every(p=>Array.isArray(p)&&p.length>=2&&p.slice(0,2).every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90)&&r[0][0]===r.at(-1)[0]&&r[0][1]===r.at(-1)[1];
 for(const f of c.features){const g=f.geometry;const polygons=g?.type==='Polygon'?[g.coordinates]:g?.type==='MultiPolygon'?g.coordinates:null;if(!polygons?.length||!polygons.every(p=>Array.isArray(p)&&p.length&&p.every(ring))||!f.properties||typeof f.properties!=='object')throw Error('Invalid Deepfire polygon geometry');}
 return c;
}
function collection(value:unknown):FeatureCollection<Point,Properties>{if(!value||typeof value!=='object'||(value as {type?:string}).type!=='FeatureCollection'||!Array.isArray((value as {features?:unknown}).features))throw Error('Deepfire response is not a GeoJSON FeatureCollection');const c=value as FeatureCollection<Point,Properties>;if(c.features.some(f=>f.geometry?.type!=='Point'||f.geometry.coordinates.length<2||!f.geometry.coordinates.slice(0,2).every(Number.isFinite)||Math.abs(f.geometry.coordinates[0])>180||Math.abs(f.geometry.coordinates[1])>90))throw Error('Invalid Deepfire point geometry');return c;}
export function parseHotspots(raw:unknown):Hotspot[]{return collection(raw).features.map(f=>{const p=f.properties||{};if(typeof p.observed_at!=='string'||!Number.isFinite(Date.parse(p.observed_at)))throw Error('Invalid hotspot timestamp');return{raw:Object.fromEntries(Object.entries(p).filter((entry):entry is [string,string|number|boolean|null]=>entry[1]===null||typeof entry[1]==='string'||typeof entry[1]==='boolean'||typeof entry[1]==='number'&&Number.isFinite(entry[1]))),id:String(f.id||p.id),position:f.geometry.coordinates.slice(0,2) as [number,number],clusterId:typeof p.cluster_id==='string'?p.cluster_id:null,frpMw:typeof p.fire_radiative_power==='number'&&Number.isFinite(p.fire_radiative_power)&&p.fire_radiative_power>=0?p.fire_radiative_power:null,confidence:String(p.confidence||'UNKNOWN'),provenance:{source:`Deepfire / ${String(p.source||'satellite')}`,observedAt:p.observed_at,retrievedAt:isoNow(),mode:'live'}};});}
export class DeepfireProvider implements FireDetectionProvider{
 private async token(){
  if(process.env.DEEPFIRE_TOKEN)return validSecret(process.env.DEEPFIRE_TOKEN,'DEEPFIRE_TOKEN');
  const client_id=validSecret(process.env.DEEPFIRE_CLIENT_ID,'DEEPFIRE_CLIENT_ID');
  const client_secret=validSecret(process.env.DEEPFIRE_CLIENT_SECRET,'DEEPFIRE_CLIENT_SECRET');
  if(tokenEntry&&tokenEntry.clientId===client_id&&tokenEntry.secret===client_secret&&tokenEntry.expiresAt>Date.now())return tokenEntry.token;
  return cached('deepfire-token-exchange',0,async()=>{
   const result=await fetchJSON<{access_token?:string;expires_in?:number}>(`${BASE}/v1/token`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id,client_secret})});
   const token=validSecret(result.access_token,'access_token');
   if(typeof result.expires_in!=='number'||!Number.isFinite(result.expires_in)||result.expires_in<=0)throw Error('Invalid Deepfire token lifetime');
   tokenEntry={token,clientId:client_id,secret:client_secret,expiresAt:Date.now()+Math.max(0,result.expires_in-30)*1000};
   return token;
  });
 }
 private async items(name:'hotspots'|'clusters'|'satellite-perimeters'|'static-heat-sources',bounds:Bounds=CATALONIA,filter='active = true'){
  if(bounds.length!==4||!bounds.every(Number.isFinite)||bounds[0]<-180||bounds[2]>180||bounds[1]<-90||bounds[3]>90||bounds[0]>=bounds[2]||bounds[1]>=bounds[3])throw Error('Invalid Deepfire bounds');
  const deadline=AbortSignal.timeout(16000);
  const token=await this.token();
  const url=new URL(`${BASE}/ogc/features/v1/collections/deepfire:${name}/items`);
  url.search=new URLSearchParams({bbox:bounds.join(','),'filter-lang':'cql2-text',filter,limit:'1000',f:'application/geo+json'}).toString();
  if(name==='static-heat-sources'){url.searchParams.delete('filter');url.searchParams.delete('filter-lang');}
  const features:FeatureCollection['features']=[];
  const ids=new Set<string>();
  for(let page=0;page<5;page++){
   url.searchParams.set('startIndex',String(features.length));
   const raw=await fetchJSON<unknown>(url.href,{headers:{Authorization:`Bearer ${token}`},signal:deadline});
   const result=name==='satellite-perimeters'||name==='static-heat-sources'?polygonCollection(raw):collection(raw);const metadata=raw as {links?:{rel?:string}[];numberMatched?:number};
   for(const feature of result.features){const id=String(feature.id??feature.properties?.id??'');if(!id||ids.has(id))throw Error('Invalid or repeated Deepfire feature');ids.add(id);features.push(feature);}
   const more=metadata.links?.some(link=>link.rel==='next')||(typeof metadata.numberMatched==='number'&&metadata.numberMatched>features.length)||result.features.length===1000;
   if(!more)return {type:'FeatureCollection' as const,features};
   if(!result.features.length)throw Error('Incomplete Deepfire pagination');
  }
  throw Error('Deepfire result limit reached; narrow the query');
 }
 async hotspots(bounds:Bounds=CATALONIA):Promise<ProviderResult<Hotspot[]>>{return cached(`deepfire-hotspots:${bounds.join(',')}`,600_000,async()=>{const data=parseHotspots(await this.items('hotspots',bounds));return{data,status:'live',detail:`${data.length} active satellite detections in the requested bounds. Active is a cluster lifecycle flag, not wildfire confirmation; acquisition timestamps determine recency.`,updatedAt:isoNow()};});}
 async clusters(bounds:Bounds=CATALONIA):Promise<ProviderResult<FireCluster[]>>{return cached(`deepfire-clusters:${bounds.join(',')}`,600_000,async()=>{const data=collection(await this.items('clusters',bounds)).features.map(f=>{const p=f.properties;if(!validTime(p.first_observed)||!validTime(p.last_observed)||Date.parse(p.first_observed)>Date.parse(p.last_observed)||typeof p.active!=='boolean')throw Error('Invalid cluster metadata');return{id:String(f.id||p.id),position:f.geometry.coordinates.slice(0,2) as [number,number],firstObserved:p.first_observed,lastObserved:p.last_observed,active:p.active};});return{data,status:'live',detail:`${data.length} active candidate fire clusters. Not official incidents.`,updatedAt:isoNow()};});}
 async perimeters(bounds:Bounds=CATALONIA):Promise<ProviderResult<FeatureCollection<Polygon|MultiPolygon,Properties>>>{return cached(`deepfire-perimeters:${bounds.join(',')}`,600_000,async()=>{const raw=polygonCollection(await this.items('satellite-perimeters',bounds));const latest=new Map<string,typeof raw.features[number]>();for(const f of raw.features){const p=f.properties;if(typeof p.cluster_id!=='string'||!validTime(p.computed_at)||(p.observed_watermark!=null&&!validTime(p.observed_watermark)))throw Error('Invalid perimeter metadata');const prior=latest.get(p.cluster_id);if(!prior||Date.parse(String(prior.properties.computed_at))<Date.parse(p.computed_at))latest.set(p.cluster_id,f);}return{data:{type:'FeatureCollection',features:[...latest.values()]},status:'live',updatedAt:isoNow(),detail:'Latest estimated satellite perimeter per cluster; not surveyed boundaries. Acquisition times determine recency.'};});}
 async staticHeatSources(bounds:Bounds=CATALONIA):Promise<ProviderResult<FeatureCollection<Polygon|MultiPolygon,Properties>>>{return cached(`deepfire-static:${bounds.join(',')}`,3600_000,async()=>({data:polygonCollection(await this.items('static-heat-sources',bounds)),status:'live',updatedAt:isoNow(),detail:'Persistent heat/reflection catalog from Deepfire / NOAA. A nearby catalog feature does not rule out a wildfire.'}));}
 /** Bounded archive query. Preserve source attributes for reproducible analysis. */
 async history(name:'hotspots'|'satellite-perimeters',bounds:Bounds,start:string,end:string,clusterId?:string){
  const from=Date.parse(start),to=Date.parse(end);
  if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from||to-from>7*86400000||to>Date.now()+300000)throw Error('Invalid history interval');
  if(clusterId&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(clusterId))throw Error('Invalid cluster id');
  const field=name==='hotspots'?'observed_at':'computed_at';
  const filter=`${field} >= TIMESTAMP('${new Date(from).toISOString()}') AND ${field} <= TIMESTAMP('${new Date(to).toISOString()}')${clusterId?` AND cluster_id = '${clusterId}'`:''}`;
  return this.items(name,bounds,filter);
 }
 /** No automatic retries: one explicit user request creates at most one upstream job. */
 async createSpread(input:{latitude:number;longitude:number;durationHours:number;model:'elmfire'|'forefire';ensembleMembers:number}){
  return fetchJSON<unknown>(`${BASE}/v1/fire-spread/simulations`,{method:'POST',headers:{Authorization:`Bearer ${await this.token()}`,'Content-Type':'application/json'},body:JSON.stringify(input)},20000);
 }
 /** Status reads never create simulation jobs. */
 async readSpread(id:string){if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw Error('Invalid simulation id');return fetchJSON<unknown>(`${BASE}/v1/fire-spread/simulations/${encodeURIComponent(id)}`,{headers:{Authorization:`Bearer ${await this.token()}`}});}
}
