import type {FeatureCollection,Polygon} from 'geojson';
/** Look up central surface-fire arrival at a crown's mapped position; not tree combustion. */
export function crownArrivalLookup(cells?:FeatureCollection<Polygon>|null){
 const buckets=new Map<string,{ring:number[][];arrival:number}[]>(),size=.001;
 for(const cell of cells?.features||[]){const arrival=cell.properties?.arrivalCentral;if(typeof arrival!=='number'||!Number.isFinite(arrival)||arrival<0)continue;const ring=cell.geometry.coordinates[0];if(!ring?.length)continue;const xs=ring.map(p=>p[0]),ys=ring.map(p=>p[1]);for(let x=Math.floor(Math.min(...xs)/size);x<=Math.floor(Math.max(...xs)/size);x++)for(let y=Math.floor(Math.min(...ys)/size);y<=Math.floor(Math.max(...ys)/size);y++){const key=`${x}:${y}`,list=buckets.get(key)||[];list.push({ring,arrival});buckets.set(key,list);}}
 return(lon:number,lat:number):number|null=>{let earliest=Infinity;for(const {ring,arrival} of buckets.get(`${Math.floor(lon/size)}:${Math.floor(lat/size)}`)||[]){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>lat)!==(b[1]>lat)&&lon<(b[0]-a[0])*(lat-a[1])/(b[1]-a[1])+a[0])inside=!inside;}if(inside)earliest=Math.min(earliest,arrival);}return Number.isFinite(earliest)?earliest:null;};
}
export function crownExposureState(arrival:number|null,minute:number){return arrival===null||minute<arrival?'unreached':minute-arrival<3?'front':'reached';}
