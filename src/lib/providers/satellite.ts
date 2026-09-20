import {DeepfireProvider, deepfireConfigured, type Bounds} from './deepfire';
import {firmsHotspots} from './firms';
import {isoNow,providerFailure} from './http';
import type {Hotspot, ProviderResult} from './types';
import {distanceKm} from '../simulation';

export type SatelliteResult = ProviderResult<Hotspot[]> & {source: string; coverage: string; covered: boolean};
/** A conservative WGS84 envelope; final distances are filtered on the sphere. */
export function satelliteBounds(lat: number, lon: number, radiusKm: number): Bounds {
  if (![lat, lon, radiusKm].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || radiusKm <= 0 || radiusKm > 100) throw Error('Invalid satellite search area');
  const dy = radiusKm / 110;
  const dx = dy / Math.max(0.00001, Math.cos((Math.abs(lat) + dy) * Math.PI / 180));
  // A full longitude envelope safely handles poles and antimeridian crossings.
  return [lon - dx < -180 || lon + dx > 180 ? -180 : lon - dx, Math.max(-90, lat - dy), lon - dx < -180 || lon + dx > 180 ? 180 : lon + dx, Math.min(90, lat + dy)];
}
/** Choose one feed to avoid double counting NOAA-20 observations shared by both providers. */
export async function locationHotspots(lat: number, lon: number, radiusKm = 10): Promise<SatelliteResult> {
  const bounds = satelliteBounds(lat, lon, radiusKm);
  const coverage = `${radiusKm} km radius; satellite overpasses are intermittent and no detections is not an all-clear.`;
  let fallback = '';
  if (deepfireConfigured()) {
    try {
      const result = await new DeepfireProvider().hotspots(bounds);
      return {...result, data: result.data.filter(h => distanceKm([lon, lat], h.position) <= radiusKm), source: 'Deepfire satellite detections', coverage, covered: true};
    } catch (error) {
      fallback = `Deepfire: ${providerFailure(error)}; using NASA FIRMS fallback. `;
    }
  } else fallback = 'Deepfire credentials are not configured; using NASA FIRMS. ';
  const inEurope = lat >= 34 && lat <= 72 && lon >= -25 && lon <= 45;
  if (!inEurope) return {data: [], status: 'unavailable', source: 'NASA FIRMS NOAA-20 VIIRS', updatedAt: isoNow(), covered: false, coverage: 'Outside configured Europe fallback coverage', detail: fallback + 'FIRMS fallback covers Europe only; no satellite assessment is available here.'};
  const result = await firmsHotspots();
  return {...result, data: result.data.filter(h => distanceKm([lon, lat], h.position) <= radiusKm), source: 'NASA FIRMS NOAA-20 VIIRS', covered: true, coverage, detail: fallback + result.detail};
}

/** Regional map uses the same primary source as prevention scans and inspections. */
export async function regionalHotspots(bounds: Bounds): Promise<SatelliteResult> {
  let fallback = 'Deepfire credentials are not configured; using NASA FIRMS. ';
  if (deepfireConfigured()) {
    try {const result = await new DeepfireProvider().hotspots(bounds);return {...result,source:'Deepfire satellite detections',covered:true,coverage:'Requested region; multiple satellite instruments'};}
    catch (error) {fallback = `Deepfire: ${providerFailure(error)}; using NASA FIRMS fallback. `;}
  }
  const result = await firmsHotspots();
  return {...result,data:result.data.filter(h=>h.position[0]>=bounds[0]&&h.position[0]<=bounds[2]&&h.position[1]>=bounds[1]&&h.position[1]<=bounds[3]),source:'NASA FIRMS NOAA-20 VIIRS',covered:true,coverage:'Europe fallback feed',detail:fallback+result.detail};
}
