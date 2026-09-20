import {PNG} from 'pngjs';
import type {FeatureCollection, Polygon, MultiPolygon} from 'geojson';
import type {Landscape, Source, WeatherFrame, XY} from './types';
import {bounds,contains,localPolygons,cellCenter, toLonLat} from './geometry';
import {cached} from '../providers/http';
import {readBuildingInventory} from './building-inventory';
const API='https://api.icgc.cat/territorial/collections';
export const GRID_SIZE=80, CELL_M=25;
type Collection=FeatureCollection<Polygon|MultiPolygon> & {numberMatched?:number;numberReturned?:number;code?:number;description?:string};
async function fetchBounded(url:string,maxBytes=16_000_000) {
  const r=await fetch(url,{signal:AbortSignal.timeout(20000),cache:'no-store'});
  if(!r.ok)throw Error(`Source returned HTTP ${r.status}: ${new URL(url).hostname}`);
  const reader=r.body?.getReader();if(!reader)throw Error('Source returned an empty body');
  const chunks:Uint8Array[]=[];let length=0;
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>maxBytes){await reader.cancel();throw Error('Source response exceeds the bounded domain limit');}chunks.push(value);}
  return Buffer.concat(chunks);
}
async function json<T>(url:string):Promise<T>{return JSON.parse((await fetchBounded(url)).toString('utf8')) as T;}
export function parseCollection(raw:Collection):Collection {
  if(raw.type!=='FeatureCollection'||!Array.isArray(raw.features)||raw.code&&raw.code!==200)throw Error('ICGC geographic query unavailable');
  for(const f of raw.features){
    if(!f.geometry||!['Polygon','MultiPolygon'].includes(f.geometry.type))throw Error('Unexpected ICGC geometry');
    const parts=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;
    if(!parts.length||parts.some(p=>!p.length||p.some(r=>r.length<4||r.some(v=>v.length<2||!Number.isFinite(v[0])||!Number.isFinite(v[1])||Math.abs(v[0])>180||Math.abs(v[1])>90)||r[0][0]!==r.at(-1)![0]||r[0][1]!==r.at(-1)![1])))throw Error('Invalid or unclosed source geometry');
  }
  return raw;
}
async function collection(name:string,bbox:number[]) {
  const features:Collection['features']=[];let matched=Infinity;
  for(let offset=0;offset<6000;offset+=1000){
    const url=`${API}/${name}/items?f=json&limit=1000&offset=${offset}&bbox=${bbox.join(',')}`;
    const page=parseCollection(await json<Collection>(url));
    if(page.numberMatched!==undefined)matched=page.numberMatched;
    features.push(...page.features);
    if(features.length>=matched||page.features.length<1000)return {type:'FeatureCollection' as const,features};
  }
  throw Error('ICGC result limit reached; select a less dense area');
}
async function concurrent<T,R>(items:T[],fn:(v:T)=>Promise<R>,n=4):Promise<R[]> {
  const result:R[]=[];let next=0;await Promise.all(Array.from({length:Math.min(n,items.length)},async()=>{while(next<items.length){const i=next++;result[i]=await fn(items[i]);}}));return result;
}
export function normalizeBuildings(raw:Collection):Landscape['buildings'] {
  const features=parseCollection(raw).features.filter(f=>f.properties?.tipus==='edi').map(f=>{
    const p=f.properties||{},h=Number(p.altura);
    return {...f,properties:{id:`icgc-rtt/${p.id??f.id}`,name:p.nom||`Building ${p.id??f.id}`,heightM:Number.isFinite(h)&&h>0&&h<500?h:null,heightSource:Number.isFinite(h)&&h>0&&h<500?'ICGC RTT height attribute':'Unknown',source:'ICGC RTT · CC BY 4.0',sourceId:p.id??f.id}};
  });
  return {type:'FeatureCollection',features:[...new Map(features.map(f=>[f.properties.id,f])).values()]};
}
export function mergeBuildings(icgc:Landscape['buildings'],osm:Landscape['buildings'],center:XY):Landscape['buildings']{
  const mapped=osm.features.map(f=>{const parts=localPolygons(f.geometry,center),b=bounds(parts);return {parts,b};});
  const extra=icgc.features.filter(f=>{
    const parts=localPolygons(f.geometry,center),b=bounds(parts);
    return !mapped.some(o=>{
      const width=Math.min(b[2],o.b[2])-Math.max(b[0],o.b[0]),height=Math.min(b[3],o.b[3])-Math.max(b[1],o.b[1]);
      if(width<=0||height<=0)return false;
      // Positive overlap plus interior probes avoids dropping adjacent shared-wall buildings.
      const probes=(p:XY[][][])=>p.flatMap(r=>r[0].map((v,i)=>{const n=r[0][(i+1)%r[0].length];return [(v[0]+n[0])/2,(v[1]+n[1])/2] as XY;}));
      return probes(parts).some(p=>contains(p,o.parts))||probes(o.parts).some(p=>contains(p,parts));
    });
  });
  return {type:'FeatureCollection',features:[...osm.features,...extra]};
}
async function inventory(center:XY) {
  return cached(`sage-icgc-v2:${center.join(',')}`,86400000,async()=>{
    // ICGC construction queries must be smaller than 50 ha. Each tile is 25 ha.
    const boxes:number[][]=[];
    for(let y=-1000;y<1000;y+=500)for(let x=-1000;x<1000;x+=500)boxes.push([...toLonLat([x,y],center),...toLonLat([x+500,y+500],center)]);
    const [buildingTiles,landcover]=await Promise.all([concurrent(boxes,b=>collection('construccions-rtt',b)),collection('cobertes-sol',[...toLonLat([-1000,-1000],center),...toLonLat([1000,1000],center)])]);
    const icgc=normalizeBuildings({type:'FeatureCollection',features:buildingTiles.flatMap(t=>t.features)});
    let buildings=icgc,osmSource:Source|undefined;const warnings:string[]=[];
    try{
      const osm=await readBuildingInventory(center);
      buildings=mergeBuildings(icgc,osm.buildings,center);
      osmSource={name:'OpenStreetMap building footprints',url:osm.url,retrievedAt:osm.retrievedAt,detail:'Dedicated building query, including multipolygon relations and courtyards. OSM footprints take precedence over overlapping ICGC features; ICGC supplies additional footprints. Unknown heights remain unknown. © OpenStreetMap contributors · ODbL.'};
    }catch{warnings.push('Supplementary OpenStreetMap buildings unavailable; ICGC-only coverage may omit urban buildings.');}
    return {buildings,landcover,osmSource,warnings,retrievedAt:new Date().toISOString()};
  });
}
function pixel(lon:number,lat:number,z:number):XY {
  const n=2**z*256,phi=lat*Math.PI/180;
  return [(lon+180)/360*n,(1-Math.asinh(Math.tan(phi))/Math.PI)/2*n];
}
export function terrariumHeight(r:number,g:number,b:number){return r*256+g+b/256-32768;}
async function terrain(center:XY) {
  return cached(`sage-terrain-v1:${center.join(',')}`,86400000,async()=>{
    const points=Array.from({length:GRID_SIZE**2},(_,i)=>pixel(...toLonLat(cellCenter(i,GRID_SIZE,CELL_M),center),14));
    const keys=[...new Set(points.map(([x,y])=>`${Math.floor(x/256)}/${Math.floor(y/256)}`))];
    const tiles=new Map(await concurrent(keys,async k=>{
      const png=PNG.sync.read(await fetchBounded(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/14/${k}.png`,1_000_000));
      if(png.width!==256||png.height!==256)throw Error('Unexpected DEM tile dimensions');
      return [k,png] as const;
    }));
    const elevations=points.map(([x,y])=>{
      const png=tiles.get(`${Math.floor(x/256)}/${Math.floor(y/256)}`)!,i=(Math.floor(y)%256*256+Math.floor(x)%256)*4;
      if(png.data[i+3]===0)throw Error('DEM contains missing terrain samples');
      return terrariumHeight(png.data[i],png.data[i+1],png.data[i+2]);
    });return {elevations,retrievedAt:new Date().toISOString()};
  });
}
export function parseSimulationWeather(raw:{hourly?:Record<string,unknown>;hourly_units?:Record<string,string>},now=Date.now()):WeatherFrame[]{
  const h=raw.hourly,u=raw.hourly_units;
  const keys=['temperature_2m','relative_humidity_2m','wind_speed_10m','wind_direction_10m','direct_normal_irradiance','diffuse_radiation','precipitation'];
  const units=['°C','%','km/h','°','W/m²','W/m²','mm'];
  if(!h||!Array.isArray(h.time)||!u||keys.some((k,i)=>u[k]!==units[i]||!Array.isArray(h[k])||(h[k] as unknown[]).length!==(h.time as unknown[]).length))throw Error('Weather fields or units are incomplete');
  const frames:WeatherFrame[]=[];const start=Math.floor(now/3600000)*3600000;
  for(let i=0;i<h.time.length;i++){
    const rawTime=h.time[i];if(typeof rawTime!=='string')continue;
    const t=Date.parse(rawTime.endsWith('Z')?rawTime:`${rawTime}Z`);
    if(t<start||t>start+5*3600000)continue;
    const values=keys.map(k=>(h[k] as unknown[])[i]);if(!values.every(v=>typeof v==='number'&&Number.isFinite(v)))throw Error('Weather has missing numerical values');
    const [temperatureC,humidityPct,windKmh,windFromDegrees,directNormalWm2,diffuseWm2,precipitationMm]=values as number[];
    if(humidityPct<0||humidityPct>100||windKmh<0||windFromDegrees<0||windFromDegrees>360||directNormalWm2<0||diffuseWm2<0||precipitationMm<0)throw Error('Weather values outside physical bounds');
    frames.push({time:new Date(t).toISOString(),temperatureC,humidityPct,windKmh,windFromDegrees,directNormalWm2,diffuseWm2,precipitationMm});
  }
  if(frames.length!==6||frames.some((f,i)=>Date.parse(f.time)!==start+i*3600000))throw Error('Six contiguous weather hours are required');
  return frames;
}
async function weather(center:XY,origin=Date.now()){
  if(!Number.isFinite(origin)||origin<Date.now()-48*3600000||origin>Date.now()+48*3600000)throw Error('Weather retrieval supports scenario origins within 48 hours of now. Captured historical forcing is required outside that window.');
  const url=new URL('https://api.open-meteo.com/v1/forecast');
  url.search=new URLSearchParams({latitude:String(center[1]),longitude:String(center[0]),hourly:'temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,direct_normal_irradiance,diffuse_radiation,precipitation',forecast_days:'3',past_days:'2',timezone:'UTC',wind_speed_unit:'kmh',temperature_unit:'celsius',precipitation_unit:'mm'}).toString();
  return {frames:parseSimulationWeather(await json(url.href),origin),retrievedAt:new Date().toISOString()};
}
export async function loadLandscape(center:XY,onStage:(stage:string)=>void,capturedWeather?:WeatherFrame[],origin=Date.now()):Promise<Landscape>{
  onStage('Loading ICGC buildings, land cover, terrain and hourly weather');
  const [geo,dem,w]=await Promise.all([inventory(center),terrain(center),capturedWeather?Promise.resolve({frames:capturedWeather,retrievedAt:new Date().toISOString()}):weather(center,origin)]);
  const sources:Source[]=[
    ...(geo.osmSource?[geo.osmSource]:[]),
    {name:'ICGC RTT buildings',url:`${API}/construccions-rtt`,retrievedAt:geo.retrievedAt,detail:'Building polygons and altura attributes. 16 bounded queries; deduplicated by source ID. © ICGC · CC BY 4.0. Inventory is not a field survey.'},
    {name:'ICGC land cover',url:`${API}/cobertes-sol`,retrievedAt:geo.retrievedAt,detail:'Mapped land-cover categories with source dates; conversion to Anderson fuel models is an uncalibrated assumption.'},
    {name:'Mapzen Terrarium DEM',url:'https://github.com/tilezen/joerd/blob/master/docs/attribution.md',retrievedAt:dem.retrievedAt,detail:'Decoded terrain elevations at zoom 14; sampled on a 25 m grid. Raster pixel spacing does not establish native DEM accuracy.'},
    ...(capturedWeather?[]:[{name:'Open-Meteo',url:'https://open-meteo.com/en/docs',retrievedAt:w.retrievedAt,detail:'Hourly modelled wind, humidity, temperature and radiation; radiation is preceding-hour mean. UTC valid times; not local station measurements.'}])
  ];
  return {center,size:GRID_SIZE,cellM:CELL_M,elevations:dem.elevations,buildings:geo.buildings,landcover:geo.landcover,weather:w.frames,sources,warnings:geo.warnings};
}
