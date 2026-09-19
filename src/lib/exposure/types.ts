import type {Feature, FeatureCollection, Point, LineString, Polygon, MultiPolygon} from 'geojson';
export const exposureCategories = {
  school: {label: 'Schools & education', color: '#f5cf76', weight: 8, cap: 16},
  healthcare: {label: 'Hospitals & care', color: '#f398ac', weight: 10, cap: 20},
  complex: {label: 'Residential & work complexes', color: '#bdadf5', weight: 4, cap: 12},
  road: {label: 'Important roads', color: '#80c6ee', weight: 2, cap: 6},
  gathering: {label: 'Potential busy places', color: '#8ed6bc', weight: 4, cap: 12},
} as const;
export type ExposureCategory = keyof typeof exposureCategories;
export type ExposureGeometry = Point | LineString | Polygon | MultiPolygon;
export type ExposureProperties = {id: string; name: string; category: ExposureCategory; kind: string; source: string; sourceUrl: string; occupancy: null; distanceM?: number};
export type ExposureFeature = Feature<ExposureGeometry, ExposureProperties>;
export type ExposureDataset = FeatureCollection<ExposureGeometry, ExposureProperties> & {
  metadata: {version: 1; importedAt: string; sourceDate: string; source: string; sourceUrl: string; license: string; skipped: number; coverage: MultiPolygon; counts: Record<ExposureCategory, number>};
};
export type ExposureSummary = {
  status: 'ready' | 'stale' | 'partial' | 'unavailable' | 'outside-coverage';
  sourceDate: string | null; importedAt: string | null; radiusM: number; bufferM: number;
  total: number | null; counts: Record<ExposureCategory, number> | null;
  score: number | null; uplift: number; hazardActive: boolean;
  contributions: {category: ExposureCategory; count: number; points: number}[];
  nearby: ExposureFeature[]; detail: string;
};
