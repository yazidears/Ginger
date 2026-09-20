import type {Feature, FeatureCollection, MultiPolygon, Polygon} from 'geojson';
import type {ScenarioContext} from '../product-contracts';
export type Footprint = Feature<Polygon | MultiPolygon>;
export type XY = [number, number];
export type RunRequest = {
  scenarioId?: string;
  lat: number; lon: number; horizonMinutes: 60 | 120 | 240;
  ignitionRadiusM: number; deadMoisturePct: number; liveMoisturePct: number;
  windAdjustment: number; mode: 'scenario' | 'confirmed'; confirmation: string;
  solarDrying: boolean;
  grassModel?: 'rothermel' | 'ginger-o2';
  structural?: {maxGapM:number;transferMinutes:number};
  experiment?: {
    parentId: string; windOffset: number; windFactor: number; windShiftMinutes: number; windOrigin?: string;
    ignitionOffset: XY; fuelBreak?: Polygon;
    observation?: {geometry: Polygon; observedAt: string; source: string};
  };
};
export type Source = {name: string; url: string; retrievedAt: string; detail: string};
export type WeatherFrame = {
  time: string; temperatureC: number; humidityPct: number; windKmh: number;
  windFromDegrees: number; directNormalWm2: number | null; diffuseWm2: number | null; precipitationMm: number;
  validForMinutes?: number; source?: string;
};
export type Landscape = {
  center: XY; size: number; cellM: number; elevations: number[];
  buildings: FeatureCollection<Polygon | MultiPolygon>;
  landcover: FeatureCollection<Polygon | MultiPolygon>;
  weather: WeatherFrame[]; sources: Source[]; warnings: string[];
};
export type BuildingResult = {
  id: string; name: string; center: XY; areaM2: number; widthM: number; lengthM: number;
  heightM: number | null; heightSource: string; source: string;
  status: 'surface-exposure' | 'structural-ignition' | 'not-reached' | 'partial-coverage';
  structuralIgnitionByMember?: (number|null)[];
  arrivalMin: number | null; arrivalMax: number | null; membersReached: number;
  arrivalByMember: (number | null)[];
  radiantKwM2: number | null; radiantAtMinute: number | null;
  solarWm2: number | null; shaded: boolean | null;
  unknowns: string[];
};
export type RunResult = {
  scenario?: ScenarioContext;
  id: string; engine: string; generatedAt: string; forecastOrigin: string;
  model?: {name: string; version: string; validation: string; stencil: 'legacy8'|'ginger16'; grassModel?: 'rothermel'|'ginger-o2'; learnedGrassCells?: number; grassFallbackCells?: number; grassArtifactId?: string};
  inputSnapshot?: boolean;
  drivers?: {name:string;areaDeltaHa:number;buildingDelta:number}[];
  request: RunRequest; runtimeMs: number; size: number; cellM: number; center: XY;
  sources: Source[]; warnings: string[]; assumptions: string[];
  members: {name: string; windFactor: number; windOffset: number; moistureOffset: number}[];
  buildings: BuildingResult[]; footprints: FeatureCollection<Polygon | MultiPolygon>;
  cells: FeatureCollection<Polygon>; domain: FeatureCollection<Polygon>;
  sun: {altitudeDegrees: number; azimuthDegrees: number};
  weather: WeatherFrame[];
  stats: {buildingCount: number; knownHeights: number; reached: number; burnedHa: number; fuelCoveragePct: number; boundaryReached: boolean};
};
export type IgnitionRecovery = {position: XY; distanceM: number};
export type RunState = {
  id: string; state: 'queued' | 'running' | 'completed' | 'failed';
  stage: string; createdAt: string; updatedAt: string; request: RunRequest;
  error?: string; ignitionRecovery?: IgnitionRecovery; result?: RunResult;
};
