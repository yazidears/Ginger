import type {ForestRun,ForestTree} from './types';
/** Crown centres inherit the model cell's arrival; this is not individual-tree combustion. */
export function crownArrivalMinutes(trees:ForestTree[],cells:NonNullable<ForestRun['result']>['cells']):number[]{
 const step=.0003,bins=new Map<string,Array<{ring:number[][];arrival:number}>>();
 for(const feature of cells.features){if(feature.geometry.type!=='Polygon')continue;const arrival=Number(feature.properties?.arrival);if(!Number.isFinite(arrival))continue;const ring=feature.geometry.coordinates[0];const xs=ring.map(p=>p[0]),ys=ring.map(p=>p[1]);for(let x=Math.floor(Math.min(...xs)/step);x<=Math.floor(Math.max(...xs)/step);x++)for(let y=Math.floor(Math.min(...ys)/step);y<=Math.floor(Math.max(...ys)/step);y++){const key=`${x}:${y}`,list=bins.get(key)||[];list.push({ring,arrival});bins.set(key,list);}}
 return trees.map(tree=>{let first=Infinity;for(const {ring,arrival} of bins.get(`${Math.floor(tree.lon/step)}:${Math.floor(tree.lat/step)}`)||[]){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>tree.lat)!==(b[1]>tree.lat)&&tree.lon<(b[0]-a[0])*(tree.lat-a[1])/(b[1]-a[1])+a[0])inside=!inside;}if(inside)first=Math.min(first,arrival);}return first;});
}
