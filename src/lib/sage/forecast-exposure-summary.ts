import type {ForecastExposure, ForecastAssetProperties} from '../product-contracts';
import type {ExposureCategory} from '../exposure/types';

/** The central forecast and the union of sensitivity members are deliberately separate. */
export function exposureAtMinute(exposure: ForecastExposure, minute: number) {
  const selected = Math.max(0, Number.isFinite(minute) ? minute : 0);
  const central = exposure.assets.features.filter(f => f.properties.arrivalCentralMinutes !== null && f.properties.arrivalCentralMinutes <= selected).map(f => f.properties);
  const sensitivity = exposure.assets.features.filter(f => f.properties.arrivalMinMinutes !== null && f.properties.arrivalMinMinutes <= selected).map(f => f.properties);
  const known = exposure.status !== 'unavailable' && exposure.status !== 'outside-coverage';
  const counts: Record<ExposureCategory | 'building', number> | null = known ? {school: 0, healthcare: 0, complex: 0, road: 0, gathering: 0, building: 0} : null;
  if (counts) for (const asset of central) counts[asset.category]++;
  const roads = central.filter(asset => asset.category === 'road');
  return {minute: selected, central, sensitivity, counts, roadSegments: known ? roads.length : null,
    namedRoads: known ? new Set(roads.map(asset => asset.roadIdentity).filter((id): id is string => id !== null)).size : null,
    unidentifiedRoadSegments: known ? roads.filter(asset => asset.roadIdentity === null).length : null};
}
export type ForecastExposureAtMinute = ReturnType<typeof exposureAtMinute>;
export type {ForecastAssetProperties};
