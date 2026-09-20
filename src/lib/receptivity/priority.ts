import type {CellResult, Snapshot, StationResult} from './types';
import type {Hotspot} from '../providers/types';
import type {ExposureSummary} from '../exposure/types';

export type LocalExposure = Pick<ExposureSummary, 'status' | 'sourceDate' | 'counts'> & {rangeM: number; nearestM: number | null};
export type PriorityLevel = 'verify' | 'review' | 'watch' | 'routine' | 'unknown';
export const PRIORITY = {
  verify: {label: 'Verify thermal signal', color: '#ef8d83', order: 4},
  review: {label: 'Review conditions', color: '#e8aa70', order: 3},
  watch: {label: 'Watch conditions', color: '#b7bc87', order: 2},
  routine: {label: 'No combined trigger', color: '#6c8b80', order: 0},
  unknown: {label: 'Evidence missing', color: '#80939e', order: 1},
} as const;
export type AreaPriority = {
  level: PriorityLevel;
  reasons: string[];
  missing: string[];
  action: string;
  thermal: {id: string; distanceKm: number; observations: number; periods: number; latestAt: string; confidence: string} | null;
  localFactors: number;
  exposureTier: number;
  weatherFresh: boolean;
};
export type PriorityArea = {id: string; cell: CellResult; priority: AreaPriority; cells: number; areaHa: number};
export type PriorityAssessment = {byCell: Map<string, AreaPriority>; areas: PriorityArea[]; counts: Record<PriorityLevel, number>; satelliteFresh: boolean};
export const PRIORITY_METHOD = 'area-review-1';
const MINUTE = 60000;
const fresh = (timestamp: string | null | undefined, maxAge: number, now: number) => {
  const age = now - Date.parse(timestamp || '');
  return Number.isFinite(age) && age >= 0 && age <= maxAge;
};
export function distanceKm(a: number[], b: number[]) {
  const p = Math.PI / 180, x = Math.sin((b[1] - a[1]) * p / 2) ** 2 + Math.cos(a[1] * p) * Math.cos(b[1] * p) * Math.sin((b[0] - a[0]) * p / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
}
/** Numeric confidence is interpreted only for MODIS's documented 0–100 scale. */
export function thermalConfidence(h: Hotspot): 'high' | 'nominal' | 'low' | 'unknown' {
  const v = h.confidence.trim().toLowerCase();
  if (['h', 'high'].includes(v)) return 'high';
  if (['n', 'nominal', 'medium'].includes(v)) return 'nominal';
  if (['l', 'low'].includes(v)) return 'low';
  if (/modis/i.test(h.provenance.source) && /^\d+(\.\d+)?$/.test(v) && +v <= 100)
    return +v >= 80 ? 'high' : +v >= 30 ? 'nominal' : 'low';
  return 'unknown';
}
/** Acquisition time governs expiry. Repeated copies and alternate IDs do not corroborate a detection. */
export function currentThermals(snapshot: Pick<Snapshot, 'satellite'>, now = Date.now()): Hotspot[] {
  if (snapshot.satellite?.status !== 'live' || !fresh(snapshot.satellite.retrievedAt, 30 * MINUTE, now)) return [];
  const seen = new Set<string>();
  return snapshot.satellite.observations.filter(h => {
    if (h.provenance.mode !== 'live' || h.position.length !== 2 || !h.position.every(Number.isFinite) || Math.abs(h.position[0]) > 180 || Math.abs(h.position[1]) > 90 || !fresh(h.provenance.observedAt, 6 * 60 * MINUTE, now)) return false;
    const key = `${h.provenance.source}:${h.provenance.observedAt}:${h.position[0].toFixed(4)}:${h.position[1].toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).sort((a, b) => a.provenance.observedAt.localeCompare(b.provenance.observedAt) || a.id.localeCompare(b.id));
}
type ThermalGroup = {id: string; observations: Hotspot[]};
function thermalGroups(observations: Hotspot[]): ThermalGroup[] {
  const groups: ThermalGroup[] = [];
  for (const h of observations) {
    // Bounded 1 km grouping about the first detection; no unbounded chain across the map.
    const group = groups.find(g => distanceKm(g.observations[0].position, h.position) <= 1);
    if (group) group.observations.push(h); else groups.push({id: h.id, observations: [h]});
  }
  return groups;
}
function assess(cell: CellResult, station: StationResult | undefined, snapshot: Snapshot, index: number, now: number, groups: ThermalGroup[], satelliteFresh: boolean, heatActive: boolean): AreaPriority {
  const f = station?.frames.find(f => f.horizon === snapshot.horizons[index]);
  const weatherFresh = !!f && fresh(station?.frames.find(f => f.horizon === 0)?.timestamp, 90 * MINUTE, now)
    && (index === 0 || fresh(station?.forecastIssuedAt, 6 * 60 * MINUTE, now) && Date.parse(f.timestamp) >= now);
  const reasons: string[] = [], missing: string[] = [];
  if (!weatherFresh) missing.push(index ? 'Fresh weather / forecast' : 'Fresh station weather');
  if (!satelliteFresh) missing.push('Fresh thermal satellite feed');
  const cover = cell.fuel.burnableFraction, continuity = cell.fuel.continuity, slope = cell.terrain.slope;
  const connected = Number.isFinite(cover) && cover >= .6 && Number.isFinite(continuity) && continuity >= .7;
  const steep = Number.isFinite(slope) && slope! >= 20;
  if (!Number.isFinite(slope)) missing.push('Mapped slope');
  const exposure = cell.localExposure;
  const exposureFresh = exposure?.status === 'ready' && fresh(exposure.sourceDate, 30 * 86400000, now);
  if (!exposureFresh) missing.push('Current local infrastructure inventory');
  const counts = exposureFresh ? exposure.counts : null;
  const exposed = !!counts && (counts.school > 0 || counts.healthcare > 0 || counts.complex > 0 || counts.road > 0);
  const satelliteVegetationFresh = fresh(cell.fuel.satelliteAt, 10 * 86400000, now) && (cell.fuel.satelliteCoverage ?? 0) >= .5;
  const vegetationDry = satelliteVegetationFresh && Number.isFinite(cell.fuel.ndmi) && cell.fuel.ndmi! >= -1 && cell.fuel.ndmi! < 0 && Number.isFinite(cell.fuel.ndvi) && cell.fuel.ndvi! >= .3 && cell.fuel.ndvi! <= 1;
  const dry = weatherFresh && Number.isFinite(f!.fineFuelMoisture) && f!.fineFuelMoisture <= 16;
  const veryDry = dry && f!.fineFuelMoisture <= 10;
  const windy = weatherFresh && (f!.conditions.windSpeed >= 25 || f!.spreadPotential >= 40);
  const localFactors = Number(connected) + Number(steep) + Number(exposed) + Number(vegetationDry);
  let level: PriorityLevel = weatherFresh && satelliteFresh && exposureFresh && Number.isFinite(slope) ? 'routine' : 'unknown';
  // Review rules are conjunctions, never percentile colours or fabricated probabilities.
  if (dry && connected && (steep || exposed || vegetationDry)) {
    level = (windy || veryDry && localFactors >= 3 || vegetationDry || heatActive) ? 'review' : 'watch';
    reasons.push(`${index ? 'Forecast' : 'Estimated'} fine-fuel moisture ${f!.fineFuelMoisture.toFixed(1)}% with ${Math.round(cover * 100)}% fuel cover and ${Math.round(continuity * 100)}% neighbourhood continuity.`);
    if (windy) reasons.push(`Dry fuel coincides with ${f!.conditions.windSpeed.toFixed(0)} km/h wind (spread index ${f!.spreadPotential}/100).`);
    if (steep) reasons.push(`Mapped slope ${slope!.toFixed(0)}° adds a terrain inspection concern.`);
    if (exposed) reasons.push(`${counts!.school + counts!.healthcare + counts!.complex + counts!.road} mapped schools, care sites, complexes or road segments within ${exposure!.rangeM.toLocaleString()} m. Occupancy unknown.`);
    if (vegetationDry) reasons.push('Recent clear-pixel vegetation imagery also has a low NDMI signal.');
    if (heatActive) reasons.push('A fresh modelled heatwave episode overlaps the selected weather day.');
  } else if (dry && windy) {
    level = 'watch'; reasons.push(`Dry fine fuels and ${f!.conditions.windSpeed.toFixed(0)} km/h wind; local fuel or consequence support is limited.`);
  }
  let thermal: AreaPriority['thermal'] = null;
  let thermalOrder = -1;
  const nearby = groups.map(g => ({g, distance: Math.min(...g.observations.map(h => distanceKm(cell.center, h.position)))})).filter(g => g.distance <= 3)
    .sort((a, b) => a.distance - b.distance || a.g.id.localeCompare(b.g.id));
  for (const {g, distance} of nearby) {
    const trusted = g.observations.filter(h => ['nominal', 'high'].includes(thermalConfidence(h)) && distanceKm(cell.center, h.position) <= 1);
    const times = trusted.map(h => Date.parse(h.provenance.observedAt)).sort((a, b) => a - b);
    let periods = 0, last = -Infinity;
    for (const time of times) if (time - last >= 10 * MINUTE) {periods++; last = time;}
    const high = trusted.some(h => thermalConfidence(h) === 'high');
    const evidenceLevel: PriorityLevel = distance <= 1 && trusted.length ? ((high || periods >= 2) && (dry || exposed) ? 'verify' : 'review') : 'watch';
    if (PRIORITY[evidenceLevel].order > thermalOrder) {
      thermalOrder = PRIORITY[evidenceLevel].order;
      thermal = {id: g.id, distanceKm: trusted.length ? Math.min(...trusted.map(h => distanceKm(cell.center, h.position))) : distance, observations: g.observations.length, periods, latestAt: g.observations.at(-1)!.provenance.observedAt, confidence: high ? 'high' : trusted.length ? 'nominal' : distance > 1 ? 'outside 1 km verification range' : 'low / unknown'};
      if (PRIORITY[evidenceLevel].order > PRIORITY[level].order) level = evidenceLevel;
    }
  }
  if (thermal) reasons.unshift(`Current thermal signal ${thermal.distanceKm.toFixed(1)} km away · ${thermal.confidence} confidence · ${thermal.periods} trusted observation period${thermal.periods === 1 ? '' : 's'}.`);
  if (!reasons.length) reasons.push(weatherFresh ? 'Available evidence does not meet a combined local review rule. Weather dryness alone does not establish a hotspot.' : 'Current local conditions cannot be assessed with the available weather evidence.');
  const action = {verify: 'Verify the thermal source with current imagery or field observation; check nearby mapped infrastructure.', review: 'Inspect this location and its evidence before deciding on a field check.', watch: 'Keep this area under watch; review changes in wind, moisture or thermal evidence.', routine: 'Continue monitoring. No combined trigger does not establish that the area is safe.', unknown: 'Restore missing inputs before interpreting the absence of a trigger.'}[level];
  const exposureTier = counts?.healthcare ? 3 : counts?.school ? 2 : counts?.complex ? 1 : 0;
  return {level, reasons, missing, action, thermal, localFactors, exposureTier, weatherFresh};
}

export function assessPriorities(snapshot: Snapshot, index: number, now = Date.now()): PriorityAssessment {
  const stations = new Map(snapshot.stations.map(s => [s.station.id, s]));
  const satelliteFresh = snapshot.satellite?.status === 'live' && fresh(snapshot.satellite.retrievedAt, 30 * MINUTE, now);
  const groups = thermalGroups(currentThermals(snapshot, now));
  const thermalIndex = new Map<string, ThermalGroup[]>();
  for (const group of groups) {
    const [x,y] = group.observations[0].position, key = `${Math.floor(x / .05)}:${Math.floor(y / .05)}`;
    const bucket = thermalIndex.get(key) || []; bucket.push(group); thermalIndex.set(key, bucket);
  }
  const day = new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(now + (snapshot.horizons[index] || 0) * 3600000);
  const activeHeat = new Set((snapshot.heatwaves || []).filter(h => fresh(h.retrievedAt, 120 * MINUTE, now) && h.episodes.some(e => e.start <= day && e.end >= day)).map(h => h.id));
  const byCell = new Map<string, AreaPriority>(), grouped = new Map<string, PriorityArea>();
  const counts: Record<PriorityLevel, number> = {verify: 0, review: 0, watch: 0, routine: 0, unknown: 0};
  for (const cell of snapshot.cells) {
    const [lon,lat] = cell.center, dy = 4 / 110, dx = dy / Math.cos(lat * Math.PI / 180), nearbyGroups: ThermalGroup[] = [];
    for (let x = Math.floor((lon-dx)/.05); x <= Math.floor((lon+dx)/.05); x++)
      for (let y = Math.floor((lat-dy)/.05); y <= Math.floor((lat+dy)/.05); y++) nearbyGroups.push(...(thermalIndex.get(`${x}:${y}`) || []));
    const p = assess(cell, stations.get(cell.stationId), snapshot, index, now, nearbyGroups, satelliteFresh, activeHeat.has(cell.evidence?.heatwaveId || ''));
    byCell.set(cell.id, p); counts[p.level]++;
    if (p.level === 'routine' || p.level === 'unknown') continue;
    // Group one thermal event once. Otherwise group review cells in fixed 2 km UTM neighbourhoods.
    const xy = /^utm31-\d+-(-?\d+)-(-?\d+)$/.exec(cell.id);
    const spatialKey = xy ? `${Math.floor(+xy[1] / 2000)}:${Math.floor(+xy[2] / 2000)}` : `${Math.floor(cell.center[0] * 42)}:${Math.floor(cell.center[1] * 55)}`;
    const key = p.thermal ? `thermal:${p.thermal.id}` : `area:${spatialKey}`;
    const previous = grouped.get(key), areaHa = snapshot.cellSizeM ** 2 / 10000 * cell.fuel.burnableFraction;
    if (!previous) grouped.set(key, {id: key, cell, priority: p, cells: 1, areaHa});
    else {
      previous.cells++; previous.areaHa += areaHa;
      if (compare(p, previous.priority) < 0) {previous.cell = cell; previous.priority = p;}
    }
  }
  const areas = [...grouped.values()].sort((a, b) => compare(a.priority, b.priority) || a.id.localeCompare(b.id));
  return {byCell, areas, counts, satelliteFresh};
}
function compare(a: AreaPriority, b: AreaPriority) {
  return PRIORITY[b.level].order - PRIORITY[a.level].order || Number(!!b.thermal) - Number(!!a.thermal)
    || (a.thermal?.distanceKm ?? Infinity) - (b.thermal?.distanceKm ?? Infinity) || b.exposureTier - a.exposureTier || b.localFactors - a.localFactors;
}
