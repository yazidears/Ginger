import {distanceBetweenParts} from './geometry';
import type {XY} from './types';
/** Scenario connectivity only; distance is not an ignition-probability model. */
export function structuralConnections(buildings:{parts:XY[][][];b:number[]}[],maxGapM:number,half:number):number[][]{
  const edges=buildings.map(()=>[] as number[]),buckets=new Map<string,number[]>(),bucketM=100;
  const eligible=buildings.map(({b})=>b[0]>=-half&&b[1]>=-half&&b[2]<=half&&b[3]<=half);
  for(let i=0;i<buildings.length;i++){
    if(!eligible[i])continue;const {b,parts}=buildings[i],candidates=new Set<number>();
    for(let y=Math.floor((b[1]-maxGapM)/bucketM);y<=Math.floor((b[3]+maxGapM)/bucketM);y++)for(let x=Math.floor((b[0]-maxGapM)/bucketM);x<=Math.floor((b[2]+maxGapM)/bucketM);x++)for(const j of buckets.get(`${x},${y}`)||[])candidates.add(j);
    for(const j of candidates){const other=buildings[j],dx=Math.max(0,b[0]-other.b[2],other.b[0]-b[2]),dy=Math.max(0,b[1]-other.b[3],other.b[1]-b[3]);
      if(Math.hypot(dx,dy)<=maxGapM+1e-6&&distanceBetweenParts(parts,other.parts)<=maxGapM+1e-6){edges[i].push(j);edges[j].push(i);}
    }
    for(let y=Math.floor(b[1]/bucketM);y<=Math.floor(b[3]/bucketM);y++)for(let x=Math.floor(b[0]/bucketM);x<=Math.floor(b[2]/bucketM);x++){const key=`${x},${y}`,list=buckets.get(key)||[];list.push(i);buckets.set(key,list);}
  }
  return edges;
}
