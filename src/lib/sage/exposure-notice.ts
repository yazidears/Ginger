import type {ForecastExposure,ForecastAssetProperties} from '../product-contracts';

/** One actual central-member arrival, never a fabricated warning or sensitivity probability. */
export function exposureNotice(exposure:ForecastExposure|null,minute:number){
  if(!exposure||exposure.status==='unavailable'||exposure.status==='outside-coverage'||!Number.isFinite(minute))return null;
  const candidates=exposure.assets.features.map(feature=>feature.properties).filter(asset=>asset.arrivalCentralMinutes!==null&&Number.isFinite(asset.arrivalCentralMinutes)&&asset.arrivalCentralMinutes>=0);
  // Nearby newly reached assets stay visible briefly; then advance to the next arrival.
  const recent=candidates.filter(asset=>asset.arrivalCentralMinutes!<=minute&&asset.arrivalCentralMinutes!>=minute-10);
  const future=candidates.filter(asset=>asset.arrivalCentralMinutes!>minute&&asset.arrivalCentralMinutes!<=minute+60);
  const rank=(asset:ForecastAssetProperties)=>asset.category==='road'&&asset.roadIdentity?0:asset.category==='healthcare'||asset.category==='school'?1:asset.category==='complex'?2:3;
  recent.sort((a,b)=>b.arrivalCentralMinutes!-a.arrivalCentralMinutes!||rank(a)-rank(b)||a.id.localeCompare(b.id));
  future.sort((a,b)=>a.arrivalCentralMinutes!-b.arrivalCentralMinutes!||rank(a)-rank(b)||a.id.localeCompare(b.id));
  const asset=recent[0]||future[0];if(!asset)return null;
  const reached=asset.arrivalCentralMinutes!<=minute;
  return {asset,reached,arrival:asset.arrivalCentralMinutes!,remaining:Math.max(0,Math.ceil(asset.arrivalCentralMinutes!-minute)),key:`${exposure.runId}:${asset.id}:${reached?'reached':'upcoming'}`};
}
