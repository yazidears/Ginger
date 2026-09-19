import {cached,fetchJSON} from './http';
export type SceneAsset={href:string;scale:number;offset:number};
export type SentinelScene={id:string;time:string;cloudPct:number|null;platform:string;assets:Record<string,SceneAsset>;thumbnail:string|null};
const ROOT='https://earth-search.aws.element84.com/v1';
export function publicAsset(href:unknown):string|null{if(typeof href!=='string')return null;try{const u=new URL(href);return u.protocol==='https:'&&u.hostname==='e84-earth-search-sentinel-data.s3.us-west-2.amazonaws.com'&&!u.username&&!u.password&&!u.port?u.href:null;}catch{return null;}}
export function parseScene(raw:unknown):SentinelScene{
 const f=raw as {id:string;properties:Record<string,unknown>;assets:Record<string,{href:string;'raster:bands'?:{scale?:number;offset?:number}[]}>};
 if(!f||typeof f.id!=='string'||!/^S2[A-C]_T[A-Z0-9]{5}_\d{8}T\d{6}_L2A$/.test(f.id)||!f.properties||!Number.isFinite(Date.parse(String(f.properties.datetime)))||!f.assets)throw Error('Invalid Sentinel scene');
 const assets:Record<string,SceneAsset>={};
 for(const key of ['red','nir','swir22','scl']){const a=f.assets[key],href=publicAsset(a?.href);if(!href)continue;const band=a['raster:bands']?.[0];if(key!=='scl'&&(!Number.isFinite(band?.scale)||!Number.isFinite(band?.offset)))continue;assets[key]={href,scale:band?.scale??1,offset:band?.offset??0};}
 return {id:f.id,time:String(f.properties.datetime),cloudPct:typeof f.properties['eo:cloud_cover']==='number'?f.properties['eo:cloud_cover']:null,platform:String(f.properties.platform||'Sentinel-2'),assets,thumbnail:publicAsset(f.assets.thumbnail?.href)};
}
export async function sentinelScenes(lat:number,lon:number){return cached(`sentinel-c1-scenes:${lat}:${lon}`,600000,async()=>{
 const url=new URL(`${ROOT}/search`);url.search=new URLSearchParams({collections:'sentinel-2-c1-l2a',bbox:[lon-.005,lat-.005,lon+.005,lat+.005].join(','),datetime:`${new Date(Date.now()-60*86400000).toISOString()}/${new Date().toISOString()}`,limit:'20',sortby:'-properties.datetime'}).toString();
 const raw=await fetchJSON<{features:unknown[];links?:{rel:string}[]}>(url.href,{},15000);
 if(!Array.isArray(raw.features))throw Error('Invalid scene search');
 return {scenes:raw.features.map(parseScene).sort((a,b)=>Date.parse(b.time)-Date.parse(a.time)),limited:raw.links?.some(l=>l.rel==='next')||false};
 });}
export async function sentinelScene(id:string){if(!/^S2[A-C]_T[A-Z0-9]{5}_\d{8}T\d{6}_L2A$/.test(id))throw Error('Invalid scene id');return cached(`sentinel-c1-scene:${id}`,3600000,async()=>parseScene(await fetchJSON(`${ROOT}/collections/sentinel-2-c1-l2a/items/${id}`,{},15000)));}
