import type {Polygon} from 'geojson';
import type {Landscape, RunRequest} from '../sage/types';

export type ReplayCase = {
  version: 1; id: string; name: string; eventId: string;
  kind: 'synthetic' | 'historical'; split: 'train' | 'validation' | 'test';
  origin: string; landscape: Landscape; request: RunRequest;
  provenance: {weatherKind: 'synthetic' | 'archived-forecast' | 'observation' | 'reanalysis';
    weatherSource: string; weatherIssuedAt: string; landscapeSource: string; landscapeValidAt: string};
  observations: {at: string; availableAt: string; source: string; uncertaintyM: number; geometry: Polygon}[];
};
export type Score = {
  iou: number | null; precision: number | null; recall: number | null;
  predictedHa: number; observedHa: number; missedHa: number; extraHa: number;
  boundaryMeanM: number | null; boundaryP95M: number | null;
  brier: number; balancedBrier: number | null;
  reliability: {forecast: number; observed: number; n: number}[];
};
export type ReplayFrame = {
  minute: number; at: string; availableAt: string; source: string; uncertaintyM: number;
  assimilated: number[]; weights: number[]; effectiveMembers: number;
  baseline: Score; updated: Score;
  observed: number[]; baselineProbability: number[]; updatedProbability: number[];
  arrival: {intervalErrorMinutes: number | null; evaluatedCells: number; noPredictedArrival: number; rightCensoredCells: number};
  observationGeometry: Polygon;
};
export type ReplayReport = {
  version: 1; id: string; name: string; eventId: string; kind: ReplayCase['kind']; split: ReplayCase['split'];
  generatedAt: string; origin: string; inputSha256: string; engine: string;
  method: string; provenance: ReplayCase['provenance']; request: RunRequest;
  size: number; cellM: number; center: [number, number]; elevations: number[];
  members: {name: string; windFactor: number; windOffset: number; moistureOffset: number}[];
  frames: ReplayFrame[]; warnings: string[]; runtimeMs: number;
  summary: {baselineMeanIoU: number | null; updatedMeanIoU: number | null; baselineBrier: number; updatedBrier: number};
};
export type ReplayJob = {id: string; state: 'queued' | 'running' | 'completed' | 'failed'; stage: string;
  createdAt: string; updatedAt: string; name: string; error?: string; result?: ReplayReport};
