import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {FeatureCollection,MultiPolygon,Position} from 'geojson';
import {cached} from './http';
export type PlanningContext={source:string;status:'reference'|'unavailable'|'outside-coverage';edition:string;detail:string;zones:{id:string;name:string}[]};
function inRing(point:Position,ring:Position[]){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
export function zonesAt(data:FeatureCollection<MultiPolygon>,lat:number,lon:number){return data.features.filter(f=>f.geometry.coordinates.some(p=>inRing([lon,lat],p[0])&&!p.slice(1).some(r=>inRing([lon,lat],r)))).map(f=>({id:String(f.id),name:String(f.properties?.name)}));}
export async function readPlanningContext(lat:number,lon:number):Promise<PlanningContext>{
 const base={source:'Generalitat de Catalunya / Bombers',edition:'ZHR v2014',detail:'Official historical fire-regime planning zones. Not current danger, an active perimeter or a calibrated forecast.'};
 try{const data=await cached('catalonia-zhr-v2014',86400000,async()=>JSON.parse(await readFile(join(process.cwd(),'data/catalonia-fire-regimes.geojson'),'utf8')) as FeatureCollection<MultiPolygon>);const zones=zonesAt(data,lat,lon);return {...base,status:zones.length?'reference':'outside-coverage',zones};}
 catch{return {...base,status:'unavailable',zones:[],detail:'Planning reference could not be loaded.'};}
}
