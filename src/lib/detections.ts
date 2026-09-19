import type {DeepfireContext} from './providers/deepfire-context';
import type {Hotspot} from './providers/types';
export const detectionRegions={catalonia:[.1,40.4,3.4,42.9],iberia:[-10,35,4,44],europe:[-25,34,45,72]} as const;
export type DetectionSnapshot={region:string;source?:string;deepfire?:DeepfireContext;status:'live'|'stale'|'unavailable';hotspots:Hotspot[];retrievedAt:string|null;latestObservation:string|null;detail:string};
export function regionalDetections(data:Hotspot[],region:keyof typeof detectionRegions,now=Date.now()){
 const b=detectionRegions[region];
 return data.filter(h=>h.position[0]>=b[0]&&h.position[0]<=b[2]&&h.position[1]>=b[1]&&h.position[1]<=b[3]&&Date.parse(h.provenance.observedAt)<=now&&now-Date.parse(h.provenance.observedAt)<=86400000).sort((a,b)=>Date.parse(b.provenance.observedAt)-Date.parse(a.provenance.observedAt));
}
