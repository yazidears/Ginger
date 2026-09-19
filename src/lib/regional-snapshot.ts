import {backendSnapshot} from './backend-snapshots';
import {regionalHotspots} from './providers/satellite';
import {readDeepfireContext} from './providers/deepfire-context';
import {detectionRegions,regionalDetections,type DetectionSnapshot} from './detections';
export function readRegionalSnapshot(region:keyof typeof detectionRegions):Promise<DetectionSnapshot>{
 return backendSnapshot<DetectionSnapshot>(`region-v1:${region}`,async()=>{
  const bounds=[...detectionRegions[region as keyof typeof detectionRegions]] as [number,number,number,number];
  const [result,deepfire]=await Promise.all([regionalHotspots(bounds),readDeepfireContext(bounds)]);
  const hotspots=regionalDetections(result.data,region as keyof typeof detectionRegions);
  return {region,source:result.source,deepfire,status:result.status==='live'?'live':'stale',hotspots,retrievedAt:result.updatedAt,latestObservation:hotspots[0]?.provenance.observedAt??null,detail:result.detail};

 },value=>{value.status='stale';value.detail+=' Saved snapshot; background refresh pending.';if(value.deepfire)value.deepfire.sources=value.deepfire.sources.map(s=>s.status==='live'?{...s,status:'stale'}:s);return value;});
}
