import {readFile, writeFile, rename} from 'node:fs/promises';
import path from 'node:path';
import type {Position, Polygon, MultiPolygon} from 'geojson';
import type {ForecastExposure, ForecastAssetProperties} from '../product-contracts';
import type {ExposureFeature, ExposureGeometry} from '../exposure/types';
import {bounds, coordinates, ExposureIndex} from '../exposure/model';
import {readExposureIndex} from '../exposure/store';
import {contains, intersectsCell, localPolygons, toLocal} from './geometry';
import type {RunResult, XY} from './types';
export {exposureAtMinute} from './forecast-exposure-summary';

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const overlaps = (a: number[], b: number[]) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
function segmentBox(a: Position, b: Position, box: number[]) {
  let low = 0, high = 1;
  for (const [p, q] of [[a[0]-b[0], a[0]-box[0]], [b[0]-a[0], box[2]-a[0]], [a[1]-b[1], a[1]-box[1]], [b[1]-a[1], box[3]-a[1]]]) {
    if (Math.abs(p) < 1e-12) {if (q < 0) return false; continue;}
    const t = q / p; if (p < 0) low = Math.max(low, t); else high = Math.min(high, t); if (low > high) return false;
  }
  return true;
}
function cellIntersection(geometry: ExposureGeometry, cell: Polygon, center: XY) {
  const box = bounds(cell);
  if (!overlaps(bounds(geometry), box)) return false;
  if (geometry.type === 'Point') return true; // bbox is exactly the model's axis-aligned cell.
  if (geometry.type === 'LineString') return geometry.coordinates.some((p, i, all) => i > 0 && segmentBox(all[i-1], p, box));
  const a = toLocal([box[0], box[1]], center), b = toLocal([box[2], box[3]], center);
  return intersectsCell(localPolygons(geometry, center), (a[0]+b[0])/2, (a[1]+b[1])/2, (b[0]-a[0])/2);
}
function inside(point: Position, geometry: Polygon | MultiPolygon, center: XY) {return contains(toLocal(point, center), localPolygons(geometry, center));}
function polygonIntersection(geometry: ExposureGeometry, polygon: Polygon | MultiPolygon, center: XY) {
  if (!overlaps(bounds(geometry), bounds(polygon))) return false;
  if (coordinates(geometry).some(p => inside(p, polygon, center))) return true;
  if (geometry.type === 'Point') return false;
  if ((geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') && coordinates(polygon).some(p => inside(p, geometry, center))) return true;
  const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();
  const edges = polygon.type === 'Polygon' ? polygon.coordinates : polygon.coordinates.flat();
  const cross = (a: Position, b: Position, c: Position) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  for (const line of lines) for (let i=1;i<line.length;i++) for (const ring of edges) for (let j=1;j<ring.length;j++) {
    const a=line[i-1],b=line[i],c=ring[j-1],d=ring[j];
    if (overlaps([Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])], [Math.min(c[0],d[0]),Math.min(c[1],d[1]),Math.max(c[0],d[0]),Math.max(c[1],d[1])]) && cross(a,b,c)*cross(a,b,d)<=0 && cross(c,d,a)*cross(c,d,b)<=0) return true;
  }
  return false;
}
function memberArrivals(values: (number | null)[][], count: number) {
  const members = Array.from({length:count}, (_, i) => {const times=values.map(v=>v[i]).filter(finite);return times.length ? Math.min(...times) : null;});
  const reached = members.filter(finite);
  return {arrivalCentralMinutes: members[0] ?? null, arrivalMinMinutes: reached.length ? Math.min(...reached) : null,
    arrivalMaxMinutes: reached.length ? Math.max(...reached) : null, membersReached: reached.length};
}
const limitations = ['Projected geometric exposure, not confirmed damage, an official road closure, or a safe-route assessment.',
  'Times are calculated model minutes. The sensitivity range includes only members reaching the asset; it is not a confidence interval or probability.',
  'Road counts are mapped segments. Named road identities are grouped by inventory label; unnamed segments cannot establish a distinct-road total.',
  'Mapped objects are not verified population, capacity or occupancy. Building footprints are not verified residential addresses; footprints already represented by a facility are not counted again.'];
function base(run: RunResult): ForecastExposure {
  return {runId:run.id,forecastOrigin:run.forecastOrigin,computedAt:new Date().toISOString(),status:'unavailable',
    inventory:{sourceDate:null,importedAt:null,source:'Unavailable',url:''},assets:{type:'FeatureCollection',features:[]},limitations:[...limitations]};
}
/** Intersect actual geometries against computed arrival cells, retaining per-member first arrival. */
export function computeForecastExposure(run: RunResult, index: ExposureIndex, now=Date.now()): ForecastExposure {
  const output=base(run), metadata=index.data.metadata;
  output.computedAt=new Date(now).toISOString();
  output.inventory={sourceDate:metadata.sourceDate,importedAt:metadata.importedAt,source:metadata.source,url:metadata.sourceUrl};
  const domain=run.domain.features[0]?.geometry;
  if (!domain) {output.limitations.push('Forecast domain geometry unavailable.');return output;}
  const domainBox=bounds(domain);
  if (!polygonIntersection(domain,metadata.coverage,run.center)) {output.status='outside-coverage';output.limitations.push('Forecast lies outside the imported inventory coverage. Missing assets are unknown, not zero.');return output;}
  const coverageParts=localPolygons(metadata.coverage,run.center);
  const fullCoverage=coordinates(domain).every(p=>contains(toLocal(p,run.center),coverageParts)) && !metadata.coverage.coordinates.some(p=>p.slice(1).some(h=>h.some(v=>inside(v,domain,run.center))));
  output.status=now-Date.parse(metadata.sourceDate)>30*86400000?'stale':!fullCoverage||metadata.skipped>0?'partial':'ready';
  if (!fullCoverage||metadata.skipped>0) output.limitations.push('Inventory coverage is partial; displayed counts are known mapped objects only.');
  const cells=run.cells.features.map(f=>({feature:f,box:bounds(f.geometry),times:(Array.isArray(f.properties?.arrivalByMember)?f.properties.arrivalByMember:[f.properties?.arrivalCentral??null]) as (number|null)[]}));
  const buildingById=new Map(run.buildings.map(b=>[b.id,b]));
  const buildings=run.footprints.features.map(f=>({feature:f,box:bounds(f.geometry),result:buildingById.get(String(f.properties?.id))}));
  const candidates=index.within(domainBox).filter(f=>polygonIntersection(f.geometry,domain,run.center));
  const seen=new Set<string>();const retained:ExposureFeature[]=[];
  for (const feature of candidates) {
    const p=feature.properties;if(seen.has(p.id))continue;seen.add(p.id);
    // A named point inside the identically named mapped area is one source facility, not two assets.
    const named=p.name.trim().toLowerCase()!==p.kind.replaceAll('_',' ').trim().toLowerCase();
    if(named&&feature.geometry.type==='Point'&&candidates.some(other=>other!==feature&&other.properties.category===p.category&&other.properties.name.trim().toLowerCase()===p.name.trim().toLowerCase()&&(other.geometry.type==='Polygon'||other.geometry.type==='MultiPolygon')&&inside((feature.geometry as GeoJSON.Point).coordinates,other.geometry,run.center)))continue;
    retained.push(feature);
  }
  for (const feature of retained) {
    const p=feature.properties,box=bounds(feature.geometry);
    const arrays=cells.filter(c=>overlaps(box,c.box)&&cellIntersection(feature.geometry,c.feature.geometry,run.center)).map(c=>c.times);
    // Facilities inside a blocking building footprint use the engine's calculated building exposure.
    for(const b of buildings)if(b.result&&overlaps(box,b.box)&&polygonIntersection(feature.geometry,b.feature.geometry,run.center))arrays.push(b.result.arrivalByMember);
    const named=p.name.trim().toLowerCase()!==p.kind.replaceAll('_',' ').trim().toLowerCase();
    output.assets.features.push({...feature,properties:{id:p.id,name:p.name,category:p.category,kind:p.kind,source:p.source,sourceUrl:p.sourceUrl,
      roadIdentity:p.category==='road'&&named?`name:${p.name.trim().toLocaleLowerCase()}`:null,...memberArrivals(arrays,run.members.length),
      coverage:coordinates(feature.geometry).every(v=>inside(v,domain,run.center))?'full':'partial'}});
  }
  for(const b of buildings){if(!b.result)continue;const r=b.result;
    // A facility already represents its underlying footprint; do not add it again as an anonymous building.
    if(output.assets.features.some(f=>f.properties.category!=='road'&&f.properties.category!=='building'&&polygonIntersection(f.geometry,b.feature.geometry,run.center)))continue;
    const properties:ForecastAssetProperties={id:r.id,name:r.name,category:'building',kind:'Building footprint',source:r.source,sourceUrl:'',roadIdentity:null,
      ...memberArrivals([r.arrivalByMember],run.members.length),coverage:r.status==='partial-coverage'?'partial':'full'};
    output.assets.features.push({...b.feature,properties});
  }
  output.assets.features.sort((a,b)=>(a.properties.arrivalCentralMinutes??Infinity)-(b.properties.arrivalCentralMinutes??Infinity)||a.properties.id.localeCompare(b.properties.id));
  return output;
}
const pending=new Map<string,Promise<ForecastExposure>>();
/** Stored beside the immutable run: later inventory refreshes cannot silently rewrite its consequences. */
export async function getForecastExposure(run: RunResult): Promise<ForecastExposure> {
  if(pending.has(run.id))return pending.get(run.id)!;
  const work=(async()=>{
    const valid=/^[0-9a-f-]{36}$/.test(run.id);
    const filename=valid?path.join(path.resolve(process.env.SAGE_RUN_DIR||'.sage-runs'),`${run.id}.exposure.json`):null;
    if(filename)try{const saved=JSON.parse(await readFile(filename,'utf8')) as ForecastExposure;if(saved.runId===run.id&&saved.forecastOrigin===run.forecastOrigin&&saved.assets?.type==='FeatureCollection'){
      if(saved.inventory.sourceDate&&Date.now()-Date.parse(saved.inventory.sourceDate)>30*86400000&&saved.status==='ready')return {...saved,status:'stale' as const,limitations:[...saved.limitations,'The immutable inventory snapshot is now older than 30 days.']};
      return saved;
    }}catch{}
    let result:ForecastExposure;
    try{result=computeForecastExposure(run,await readExposureIndex());}catch{result=base(run);result.limitations.push('Asset inventory unavailable. No exposure count is reported; this does not mean no assets are exposed.');}
    if(filename&&result.status!=='unavailable')try{const temp=`${filename}.${process.pid}.tmp`;await writeFile(temp,JSON.stringify(result));await rename(temp,filename);}catch{/* Read-only storage still returns this explicitly dated calculation. */}
    return result;
  })().finally(()=>pending.delete(run.id));pending.set(run.id,work);return work;
}
