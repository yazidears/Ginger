import type {FeatureCollection,Polygon,MultiPolygon,Position} from 'geojson';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {cached} from '../providers/http';
import {contains,toLonLat} from './geometry';
import type {XY} from './types';
export type OSMBuildingElement={type:string;id:number;nodes?:number[];lat?:number;lon?:number;tags?:Record<string,string>;geometry?:{lat:number;lon:number}[];members?:{type:string;ref:number;role:string;geometry?:{lat:number;lon:number}[]}[]};
const same=(a:Position,b:Position)=>a[0]===b[0]&&a[1]===b[1];
function ringSegments(segments:Position[][]):Position[][]{
  const pending=segments.map(s=>s.slice()),rings:Position[][]=[];
  while(pending.length){const ring=pending.shift()!;
    while(!same(ring[0],ring.at(-1)!)){
      const at=pending.findIndex(s=>same(ring.at(-1)!,s[0])||same(ring.at(-1)!,s.at(-1)!));
      if(at<0)throw Error('Incomplete building relation');
      const next=pending.splice(at,1)[0];if(!same(ring.at(-1)!,next[0]))next.reverse();ring.push(...next.slice(1));
    }
    if(ring.length<4)throw Error('Invalid building ring');rings.push(ring);
  }return rings;
}
export function parseBuildingFootprints(elements:OSMBuildingElement[]):FeatureCollection<Polygon|MultiPolygon>{
  const features:FeatureCollection<Polygon|MultiPolygon>['features']=[],represented=new Set<number>();
  const points=(g:OSMBuildingElement['geometry'])=>g&&g.length>=2&&g.every(p=>p&&Number.isFinite(p.lon)&&Number.isFinite(p.lat)&&Math.abs(p.lon)<=180&&Math.abs(p.lat)<=90)?g.map(p=>[p.lon,p.lat]):null;
  // Relations first, so member ways are not duplicated and courtyards remain holes.
  for(const e of [...elements].sort((a,b)=>Number(b.type==='relation')-Number(a.type==='relation'))){
    const tags=e.tags||{};if(!tags.building||tags.building==='no'||e.type==='way'&&represented.has(e.id))continue;
    let geometry:Polygon|MultiPolygon;
    if(e.type==='relation'&&tags.type==='multipolygon'){
      const members=(e.members||[]).filter(m=>m.type==='way'&&['outer','inner',''].includes(m.role));
      const segments=members.map(m=>({role:m.role,points:points(m.geometry)}));
      if(!segments.length||segments.some(s=>!s.points))continue;
      try{
        const outer=ringSegments(segments.filter(s=>s.role!=='inner').map(s=>s.points!)),inner=ringSegments(segments.filter(s=>s.role==='inner').map(s=>s.points!));
        if(!outer.length)continue;
        const polys=outer.map(r=>[r]);
        for(const hole of inner){const at=outer.findIndex(r=>contains(hole[0] as XY,[[r as XY[]]]));if(at<0)throw Error('Unassigned courtyard');polys[at].push(hole);}
        geometry={type:'MultiPolygon',coordinates:polys};members.forEach(m=>represented.add(m.ref));
      }catch{continue;}
    }else if(e.type==='way'){
      const ring=points(e.geometry);if(!ring||ring.length<4||!same(ring[0],ring.at(-1)!))continue;
      geometry={type:'Polygon',coordinates:[ring]};
    }else continue;
    const h=tags.height&&/^\d+(\.\d+)?\s*m?$/.test(tags.height)?parseFloat(tags.height):NaN,levels=Number(tags['building:levels']);
    const measured=Number.isFinite(h)&&h>0&&h<500,estimated=Number.isFinite(levels)&&levels>0&&levels<150;
    features.push({type:'Feature',geometry,properties:{id:`${e.type}/${e.id}`,name:tags.name||tags['addr:street']||tags.building,source:'OpenStreetMap · ODbL',heightM:measured?h:estimated?levels*3:null,heightSource:measured?'osm-height':estimated?'estimated-levels':'unknown',heightBasis:measured?'OSM height tag (unverified)':estimated?'Estimated: OSM building levels × 3 m':'Unknown',tags}});
  }
  return {type:'FeatureCollection',features};
}
export function hydrateMapElements(elements:OSMBuildingElement[]):OSMBuildingElement[]{
  const unique=[...new Map(elements.map(e=>[`${e.type}/${e.id}`,e])).values()];
  const nodes=new Map(unique.filter(e=>e.type==='node').map(e=>[e.id,e]));
  const ways=new Map(unique.filter(e=>e.type==='way').map(e=>{
    const points=e.nodes?.map(id=>nodes.get(id));
    const geometry=points?.every(p=>p&&Number.isFinite(p.lat)&&Number.isFinite(p.lon))?points.map(p=>({lat:p!.lat!,lon:p!.lon!})):undefined;
    return [e.id,{...e,geometry}];
  }));
  return unique.filter(e=>e.tags?.building).map(e=>e.type==='way'?ways.get(e.id)!:{...e,members:e.members?.map(m=>({...m,geometry:ways.get(m.ref)?.geometry}))});
}
async function readMapFallback(center:XY,halfM:number){
  if(halfM>1000)throw Error('Fallback exceeds bounded map extent');
  const elements:OSMBuildingElement[]=[],boxes:string[]=[];
  // Four small map extracts, never a regional/bulk download; two requests at
  // a time. Shared disk cache reuses the inventory in preview and worker.
  for(let y=-halfM;y<halfM;y+=halfM)for(let x=-halfM;x<halfM;x+=halfM)boxes.push([...toLonLat([x,y],center),...toLonLat([x+halfM,y+halfM],center)].join(','));
  let next=0;
  await Promise.all(Array.from({length:2},async()=>{while(next<boxes.length){
    const bbox=boxes[next++];
    const r=await fetch(`https://api.openstreetmap.org/api/0.6/map.json?bbox=${bbox}`,{headers:{'User-Agent':'GINGER-Wildfire-Prototype/0.1 (bounded building inventory; local research)'},signal:AbortSignal.timeout(30000),cache:'no-store'});
    if(!r.ok)throw Error(`Bounded OSM map unavailable (HTTP ${r.status})`);
    const reader=r.body!.getReader(),chunks:Uint8Array[]=[];let bytes=0;
    while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>16_000_000){await reader.cancel();throw Error('Bounded map exceeds size limit');}chunks.push(value);}
    const raw=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(!Array.isArray(raw.elements))throw Error('Invalid OSM map');elements.push(...raw.elements);
  }}));
  return {buildings:parseBuildingFootprints(hydrateMapElements(elements)),retrievedAt:new Date().toISOString(),url:'https://api.openstreetmap.org/api/0.6/map'};
}
export async function readBuildingInventory(center:XY,halfM=1000){
  return cached(`building-inventory-v2:${center.join(',')}:${halfM}`,86400000,async()=>{
    const directory=path.join(process.cwd(),'.ginger-data','building-inventory');
    const filename=path.join(directory,`${center[0].toFixed(5)}_${center[1].toFixed(5)}_${halfM}.json`);
    try{
      const saved=JSON.parse(await readFile(filename,'utf8'));
      const age=Date.now()-Date.parse(saved.retrievedAt);
      if(age>=0&&age<86400000&&saved.buildings?.type==='FeatureCollection'&&Array.isArray(saved.buildings.features)&&saved.buildings.features.every((f:{geometry?:{type?:string}})=>['Polygon','MultiPolygon'].includes(f.geometry?.type||'')))return saved as {buildings:FeatureCollection<Polygon|MultiPolygon>;retrievedAt:string;url:string};
    }catch{/* Cache is optional; reacquire validated source data. */}
    const save=async(result:{buildings:FeatureCollection<Polygon|MultiPolygon>;retrievedAt:string;url:string})=>{
      try{await mkdir(directory,{recursive:true});const temp=`${filename}.${randomUUID()}.tmp`;await writeFile(temp,JSON.stringify(result));await rename(temp,filename);}catch{/* Source remains usable if the cache cannot be written. */}
      return result;
    };
    const sw=toLonLat([-halfM,-halfM],center),ne=toLonLat([halfM,halfM],center),bbox=[sw[1],sw[0],ne[1],ne[0]].join(',');
    // Independent building query: roads/land use cannot consume a shared result cap.
    const query=`[out:json][timeout:8];(way[building][building!=no](${bbox});relation[type=multipolygon][building][building!=no](${bbox}););out body geom 12001;`;
    for(const endpoint of ['https://overpass.private.coffee/api/interpreter','https://overpass-api.de/api/interpreter']){
      try{
        const response=await fetch(endpoint,{method:'POST',headers:{'Accept':'application/json','Content-Type':'application/x-www-form-urlencoded','User-Agent':'GINGER-Wildfire-Prototype/0.1 (bounded building inventory; local research)'},body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(12000),cache:'no-store'});
        if(!response.ok)continue;
        const raw=await response.json() as {elements:OSMBuildingElement[];remark?:string};
        if(!Array.isArray(raw.elements)||raw.remark||raw.elements.length>=12001)continue;
        const result={buildings:parseBuildingFootprints(raw.elements),retrievedAt:new Date().toISOString(),url:endpoint};
        // Share the exact inventory with the isolated simulation worker.
        return await save(result);
      }catch{/* Try the alternate; never fabricate absent footprints. */}
    }
    return await save(await readMapFallback(center,halfM));
  });
}
