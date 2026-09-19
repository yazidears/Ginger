import type {Score} from './types';

export function boundary(mask: number[], size: number): number[] {
  return mask.map((v, i) => v && (i < size || i >= mask.length-size || i%size === 0 || i%size === size-1 ||
    !mask[i-1] || !mask[i+1] || !mask[i-size] || !mask[i+size]) ? 1 : 0);
}

/** Exact separable squared Euclidean distance on a bounded grid. O(size^3), <=80^3 per pass. */
export function distanceField(seeds: number[], size: number): number[] {
  const horizontal = Array(seeds.length).fill(Infinity), result = [...horizontal];
  for(let y=0;y<size;y++) {
    const xs = Array.from({length:size},(_,x)=>x).filter(x=>seeds[y*size+x]);
    for(let x=0;x<size;x++)for(const sx of xs)horizontal[y*size+x]=Math.min(horizontal[y*size+x],(x-sx)**2);
  }
  for(let x=0;x<size;x++)for(let y=0;y<size;y++) {
    let best=Infinity;
    for(let sy=0;sy<size;sy++)best=Math.min(best,horizontal[sy*size+x]+(y-sy)**2);
    result[y*size+x]=Math.sqrt(best);
  }
  return result;
}

export function scoreForecast(probability: number[], observed: number[], size: number, cellM: number): Score {
  if(probability.length!==size*size || observed.length!==probability.length || probability.some(p=>!Number.isFinite(p)||p<0||p>1))throw Error('Invalid scoring grid');
  const predicted=probability.map(p=>p>=.5?1:0);
  let tp=0,fp=0,fn=0,positiveError=0,negativeError=0,nPos=0,nNeg=0;
  const bins=Array.from({length:10},()=>({forecast:0,observed:0,n:0}));
  probability.forEach((p,i)=>{
    if(predicted[i]&&observed[i])tp++;else if(predicted[i])fp++;else if(observed[i])fn++;
    const e=(p-observed[i])**2;
    if(observed[i]){positiveError+=e;nPos++;}else{negativeError+=e;nNeg++;}
    const bin=bins[Math.min(9,Math.floor(p*10))];bin.forecast+=p;bin.observed+=observed[i];bin.n++;
  });
  const a=boundary(predicted,size),b=boundary(observed,size);
  const distances:number[]=[];
  if(a.some(Boolean)&&b.some(Boolean)) {
    const da=distanceField(a,size),db=distanceField(b,size);
    a.forEach((v,i)=>{if(v)distances.push(db[i]*cellM);if(b[i])distances.push(da[i]*cellM);});
    distances.sort((x,y)=>x-y);
  }
  const ha=cellM*cellM/10000;
  return {iou:tp+fp+fn?tp/(tp+fp+fn):null,precision:tp+fp?tp/(tp+fp):null,recall:tp+fn?tp/(tp+fn):null,
    predictedHa:(tp+fp)*ha,observedHa:(tp+fn)*ha,missedHa:fn*ha,extraHa:fp*ha,
    boundaryMeanM:distances.length?distances.reduce((s,v)=>s+v,0)/distances.length:null,
    boundaryP95M:distances.length?distances[Math.ceil(.95*distances.length)-1]:null,
    brier:(positiveError+negativeError)/probability.length,
    balancedBrier:nPos&&nNeg?(positiveError/nPos+negativeError/nNeg)/2:null,
    reliability:bins.filter(b=>b.n).map(b=>({n:b.n,forecast:b.forecast/b.n,observed:b.observed/b.n}))};
}

/** Tempered, class-balanced likelihood; uncertain boundary cells carry no weight.
 * This is experimental evidence weighting, not a calibrated Bayesian posterior. */
export function updateWeights(weights:number[], arrivals:number[][], observed:number[], minute:number, size:number, uncertaintyCells:number):number[] {
  const edgeDistance=distanceField(boundary(observed,size),size);
  const trusted=observed.map((_,i)=>edgeDistance[i]>uncertaintyCells);
  const logs=weights.map((w,m)=>{
    let missed=0,extra=0,pos=0,neg=0;
    observed.forEach((v,i)=>{if(!trusted[i])return;const hit=arrivals[m][i]<=minute;if(v){pos++;if(!hit)missed++;}else{neg++;if(hit)extra++;}});
    const loss=(pos?missed/pos:0)+(neg?extra/neg:0);
    return Math.log(Math.max(w,1e-15))-4*loss;
  });
  const maximum=Math.max(...logs),unnormalized=logs.map(v=>Math.exp(v-maximum)),sum=unnormalized.reduce((s,v)=>s+v,0);
  // A fixed 2% prior mixture limits degeneracy without manufacturing new trajectories.
  return unnormalized.map(v=>.98*v/sum+.02/weights.length);
}

export function probabilityAt(arrivals:number[][], weights:number[], minute:number):number[] {
  return arrivals[0].map((_,i)=>Math.min(1,Math.max(0,arrivals.reduce((s,row,m)=>s+(row[i]<=minute?weights[m]:0),0))));
}
