import type {MultiPolygon, Polygon, Position} from 'geojson';
import type {XY} from './types';
const R = 6371008.8;
const rad = Math.PI / 180;
// Local tangent-plane approximation over a bounded 2 km domain. East / north metres.
export function toLocal(p: Position, center: XY): XY {
  return [(p[0] - center[0]) * rad * R * Math.cos(center[1] * rad), (p[1] - center[1]) * rad * R];
}
export function toLonLat(p: XY, center: XY): XY {
  return [center[0] + p[0] / (rad * R * Math.cos(center[1] * rad)), center[1] + p[1] / (rad * R)];
}
export function polygons(g: Polygon | MultiPolygon): Position[][][] { return g.type === 'Polygon' ? [g.coordinates] : g.coordinates; }
export function localPolygons(g: Polygon | MultiPolygon, center: XY): XY[][][] { return polygons(g).map(p => p.map(r => r.map(v => toLocal(v, center)))); }
function onSegment(p: XY, a: XY, b: XY) {
  return Math.abs((p[1]-a[1])*(b[0]-a[0])-(p[0]-a[0])*(b[1]-a[1])) < 1e-7 && p[0] >= Math.min(a[0],b[0])-1e-7 && p[0] <= Math.max(a[0],b[0])+1e-7 && p[1] >= Math.min(a[1],b[1])-1e-7 && p[1] <= Math.max(a[1],b[1])+1e-7;
}
function inRing(p: XY, ring: XY[]) {
  let inside = false;
  for (let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i], b=ring[j];
    if (onSegment(p,a,b)) return true;
    if ((a[1]>p[1]) !== (b[1]>p[1]) && p[0] < (b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]) inside=!inside;
  }
  return inside;
}
export function contains(p: XY, parts: XY[][][]) { return parts.some(rings => inRing(p,rings[0]) && !rings.slice(1).some(r=>inRing(p,r))); }
export function bounds(parts: XY[][][]) {
  const pts=parts.flat(2);return [Math.min(...pts.map(p=>p[0])),Math.min(...pts.map(p=>p[1])),Math.max(...pts.map(p=>p[0])),Math.max(...pts.map(p=>p[1]))];
}
export function area(parts: XY[][][]) {
  const ringArea=(r:XY[])=>Math.abs(r.reduce((s,p,i)=>{const q=r[(i+1)%r.length];return s+p[0]*q[1]-q[0]*p[1];},0)/2);
  return parts.reduce((s,r)=>s+ringArea(r[0])-r.slice(1).reduce((a,h)=>a+ringArea(h),0),0);
}
// Segment / axis-aligned rectangle clipping catches thin buildings and crossing edges.
function crossesBox(a:XY,b:XY,x0:number,y0:number,x1:number,y1:number) {
  let lo=0,hi=1;
  for(const [p,q] of [[a[0]-b[0],a[0]-x0],[b[0]-a[0],x1-a[0]],[a[1]-b[1],a[1]-y0],[b[1]-a[1],y1-a[1]]]) {
    if(Math.abs(p)<1e-12){if(q<0)return false;continue;}const t=q/p;if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);if(lo>hi)return false;
  }return true;
}
export function intersectsCell(parts:XY[][][],x:number,y:number,half:number) {
  if ([[x-half,y-half],[x+half,y-half],[x+half,y+half],[x-half,y+half],[x,y]].some(p=>contains(p as XY,parts))) return true;
  return parts.some(rings=>rings.some(r=>r.some((p,i)=>crossesBox(p,r[(i+1)%r.length],x-half,y-half,x+half,y+half))));
}
export function distanceToParts(p:XY,parts:XY[][][]) {
  if(contains(p,parts))return 0;
  let best=Infinity;
  for(const r of parts.flat())for(let i=0;i<r.length;i++){
    const a=r[i],b=r[(i+1)%r.length],dx=b[0]-a[0],dy=b[1]-a[1];
    const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));
    best=Math.min(best,Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy));
  }return best;
}
export function cellCenter(i:number,size:number,cellM:number):XY {return [((i%size)+.5-size/2)*cellM,(Math.floor(i/size)+.5-size/2)*cellM];}
export function indexAt(p:XY,size:number,cellM:number) {const x=Math.floor(p[0]/cellM+size/2),y=Math.floor(p[1]/cellM+size/2);return x<0||y<0||x>=size||y>=size?-1:y*size+x;}
export function cellPolygon(x:number,y:number,half:number,center:XY):Polygon {return {type:'Polygon',coordinates:[[[x-half,y-half],[x+half,y-half],[x+half,y+half],[x-half,y+half],[x-half,y-half]].map(p=>toLonLat(p as XY,center))]};}

export function distanceBetweenParts(a:XY[][][],b:XY[][][]):number {
  let best=Infinity;
  for(const p of a.flat(2))best=Math.min(best,distanceToParts(p,b));
  for(const p of b.flat(2))best=Math.min(best,distanceToParts(p,a));
  if(best===0)return 0;
  const cross=(p:XY,q:XY,r:XY)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
  for(const ar of a.flat())for(let i=0;i<ar.length-1;i++)for(const br of b.flat())for(let j=0;j<br.length-1;j++){
    const p=ar[i],q=ar[i+1],r=br[j],s=br[j+1];
    if(Math.max(p[0],q[0])<Math.min(r[0],s[0])||Math.max(r[0],s[0])<Math.min(p[0],q[0])||Math.max(p[1],q[1])<Math.min(r[1],s[1])||Math.max(r[1],s[1])<Math.min(p[1],q[1]))continue;
    if(cross(p,q,r)*cross(p,q,s)<=0&&cross(r,s,p)*cross(r,s,q)<=0)return 0;
  }
  return best;
}
