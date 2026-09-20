import {randomUUID} from 'node:crypto';
import type {ScenarioContext, EvidenceRecord} from './product-contracts';
import {validatePolygon} from './sage/investigation';

/** An operator assertion is retained as such; this does not verify an official incident. */
export function buildIncidentScenario(raw: unknown, now = new Date()): ScenarioContext {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Provide incident evidence.');
  const value = raw as Record<string, unknown>;
  const text = (key: string, min: number, max: number) => {
    const result = value[key];
    if (typeof result !== 'string' || result.trim().length < min || result.length > max) throw Error(`Provide ${key} (${min}–${max} characters).`);
    return result.trim();
  };
  if (value.confirmed !== true) throw Error('Explicit operator confirmation is required. Satellite detections alone are unverified.');
  const name = text('name', 3, 120), source = text('source', 5, 240), observedAt = text('observedAt', 16, 40);
  const observed = Date.parse(observedAt);
  if (!Number.isFinite(observed) || !/Z$|[+-]\d\d:\d\d$/.test(observedAt) || observed > now.getTime() + 60000) throw Error('Provide a valid observation time with timezone, not in the future.');
  const lat = value.lat, lon = value.lon;
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < 40.53 || lat > 42.86 || typeof lon !== 'number' || !Number.isFinite(lon) || lon < .16 || lon > 3.3) throw Error('Select a location in the supported Catalonia model region.');
  const geometry = value.startingGeometry ? validatePolygon(value.startingGeometry) : {type: 'Point' as const, coordinates: [lon, lat]};
  if (geometry.type === 'Polygon' && geometry.coordinates.flat().some(([x, y]) => Math.abs(x - lon) > .03 || Math.abs(y - lat) > .03)) throw Error('Starting geometry must fit the local scenario domain.');
  const at = now.toISOString(), id = randomUUID(), observationTime = new Date(observed).toISOString();
  const evidence: EvidenceRecord = {
    id: `incident:${id}`, source, kind: 'observed', observedAt: observationTime, validAt: observationTime,
    retrievedAt: at, extent: null, resolutionM: null, crs: 'EPSG:4326', units: 'geographic coordinates',
    coverage: geometry.type === 'Point' ? 'partial' : 'unknown',
    status: now.getTime() - observed > 3600000 ? 'stale' : 'available',
    detail: 'Operator-provided incident confirmation; not independently verified by GINGER.', consumers: ['Sage initial condition', 'Ash incident status'],
  };
  return {
    version: 1, id, name, createdAt: at, basis: 'confirmed-incident', center: [lon, lat], ignitionAt: observationTime,
    assessment: null,
    incident: {id: `operator:${id}`, name, source, observedAt: observationTime, confirmation: 'confirmed', confirmationBasis: evidence.detail, geometry, evidence: [evidence]},
    evidence: [evidence], inputs: {weather: [], deadMoisturePct: null, liveMoisturePct: null},
    assumptions: geometry.type === 'Point' ? ['Observed perimeter unavailable; the selected ignition-radius assumption sets the starting footprint.'] : [],
    limitations: ['Environmental forcing must cover the incident observation time before forecasting.', ...(geometry.type === 'Point' ? ['Partial starting geometry: a confirmed location is not an observed perimeter.'] : [])],
  };
}
