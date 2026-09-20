import type {FeatureCollection, Geometry, Polygon} from 'geojson';
import type {WeatherFrame} from './sage/types';
import type {ExposureCategory, ExposureGeometry} from './exposure/types';

/** Product boundary contracts. Times are ISO UTC; positions are WGS84 [longitude, latitude]. */
export type EvidenceRecord = {
  id: string; source: string; url?: string;
  kind: 'observed' | 'derived' | 'forecast' | 'assumed';
  observedAt: string | null; validAt: string | null; retrievedAt: string | null;
  extent: [number, number, number, number] | null; resolutionM: number | null;
  crs: string; units: string; coverage: 'full' | 'partial' | 'unknown';
  status: 'available' | 'stale' | 'unavailable'; detail: string;
  consumers: string[];
};
export type AreaAssessmentContext = {
  id: string; cellId: string; name: string; center: [number, number];
  geometry: Polygon; capturedAt: string; validAt: string; horizonHours: number;
  conclusion: string; drivers: string[]; limitations: string[]; nextAction: string;
  evidence: EvidenceRecord[];
};
export type IncidentContext = {
  id: string; name: string; source: string; sourceUrl?: string;
  observedAt: string; confirmation: 'confirmed' | 'unverified'; confirmationBasis: string;
  geometry: Geometry | null; evidence: EvidenceRecord[];
};
export type ScenarioContext = {
  version: 1; id: string; name: string; createdAt: string;
  basis: 'hypothetical' | 'confirmed-incident'; center: [number, number];
  ignitionAt: string; assessment: AreaAssessmentContext | null; incident: IncidentContext | null;
  evidence: EvidenceRecord[];
  /** Supported inputs only; absent fields are unknown, never inferred zeroes. */
  inputs: {
    weather: WeatherFrame[];
    deadMoisturePct: number | null; liveMoisturePct: number | null;
    fuel?: {type: string; source: string; epoch: string; continuity: number | null};
    terrain?: {elevationM: number | null; slopeDegrees: number | null; aspectDegrees: number | null};
  };
  assumptions: string[]; limitations: string[];
};
export type ForecastAssetProperties = {
  id: string; name: string; category: ExposureCategory | 'building'; kind: string;
  source: string; sourceUrl: string; roadIdentity: string | null;
  arrivalCentralMinutes: number | null; arrivalMinMinutes: number | null; arrivalMaxMinutes: number | null;
  membersReached: number; coverage: 'full' | 'partial';
};
export type ForecastExposure = {
  runId: string; forecastOrigin: string; computedAt: string;
  status: 'ready' | 'stale' | 'partial' | 'unavailable' | 'outside-coverage';
  inventory: {sourceDate: string | null; importedAt: string | null; source: string; url: string};
  assets: FeatureCollection<ExposureGeometry, ForecastAssetProperties>;
  limitations: string[];
};
export type ProductSelection = {
  scenarioId?: string; incidentId?: string; runId?: string; minute?: number;
  assetId?: string; center?: [number, number];
};
export type OperationalEvent = {
  id: string; roomId: string; at: string; actor: string;
  kind: 'joined' | 'left' | 'forecast' | 'evidence' | 'tool' | 'draft-task' | 'field-report' | 'session' | 'message';
  summary: string; runId: string | null; scenarioId: string | null;
  minute: number | null; verification: 'system' | 'unverified' | 'operator-authorised';
};
export type OperationalRoomContext = {
  id: string; name: string; createdAt: string; scenarioId: string | null;
  incident: IncidentContext | null; runId: string | null; minute: number;
};
