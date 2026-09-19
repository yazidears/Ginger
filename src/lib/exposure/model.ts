import type {Position} from 'geojson';
import {exposureCategories, type ExposureCategory, type ExposureDataset, type ExposureFeature, type ExposureGeometry, type ExposureSummary} from './types';
export const emptyCounts = (): Record<ExposureCategory, number> => ({school: 0, healthcare: 0, complex: 0, road: 0, gathering: 0});
export function inRing(p: Position, ring: Position[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function inPolygon(p: Position, rings: Position[][]) {return inRing(p, rings[0]) && !rings.slice(1).some(r => inRing(p, r));}
export function coordinates(g: ExposureGeometry): Position[] {
  return g.type === 'Point' ? [g.coordinates] : g.type === 'LineString' ? g.coordinates : g.type === 'Polygon' ? g.coordinates.flat() : g.coordinates.flat(2);
}
export function bounds(g: ExposureGeometry): [number, number, number, number] {
  const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of coordinates(g)) {box[0] = Math.min(box[0], p[0]); box[1] = Math.min(box[1], p[1]); box[2] = Math.max(box[2], p[0]); box[3] = Math.max(box[3], p[1]);}
  return box;
}
/** Local equirectangular metres. Query radii <= 15 km in Catalonia; polygons retain holes. */
export function distanceToGeometry(lon: number, lat: number, g: ExposureGeometry): number {
  const project = (p: Position) => [(p[0] - lon) * 111195 * Math.cos(lat * Math.PI / 180), (p[1] - lat) * 111195];
  if (g.type === 'Point') return Math.hypot(...project(g.coordinates));
  const polygons = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  if (polygons.some(p => inPolygon([lon, lat], p))) return 0;
  const lines = g.type === 'LineString' ? [g.coordinates] : polygons.flat();
  let distance = Infinity;
  for (const line of lines) for (let i = 1; i < line.length; i++) {
    const a = project(line[i - 1]), b = project(line[i]);
    const dx = b[0] - a[0], dy = b[1] - a[1], length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / length)) : 0;
    distance = Math.min(distance, Math.hypot(a[0] + t * dx, a[1] + t * dy));
  }
  return distance;
}
const CELL = .1;
export class ExposureIndex {
  private cells = new Map<string, number[]>();
  private boxes: [number, number, number, number][];
  constructor(readonly data: ExposureDataset) {
    this.boxes = data.features.map(f => bounds(f.geometry));
    this.boxes.forEach((box, index) => this.keys(box).forEach(key => {
      const cell = this.cells.get(key) || []; cell.push(index); this.cells.set(key, cell);
    }));
  }
  private keys(box: [number, number, number, number]) {
    const keys: string[] = [];
    for (let x = Math.floor(box[0] / CELL); x <= Math.floor(box[2] / CELL); x++)
      for (let y = Math.floor(box[1] / CELL); y <= Math.floor(box[3] / CELL); y++) keys.push(`${x}:${y}`);
    return keys;
  }
  within(box: [number, number, number, number]) {
    const ids = new Set(this.keys(box).flatMap(key => this.cells.get(key) || []));
    return [...ids].filter(i => {const b = this.boxes[i]; return b[0] <= box[2] && b[2] >= box[0] && b[1] <= box[3] && b[3] >= box[1];}).map(i => this.data.features[i]);
  }
  summary(lon: number, lat: number, radiusM: number, hazardActive: boolean, now = Date.now()): ExposureSummary {
    const bufferM = 1000, range = radiusM + bufferM;
    const dy = range / 111195, dx = dy / Math.cos(lat * Math.PI / 180);
    const metadata = this.data.metadata;
    const coverage = metadata.coverage.coordinates;
    const covered = (p: Position) => coverage.some(polygon => inPolygon(p, polygon));
    const inside = covered([lon, lat]);
    if (!inside) return unavailableExposure(radiusM, hazardActive, 'outside-coverage', 'Outside the stored Catalonia extract.');
    const partial = metadata.skipped > 0 || Array.from({length: 32}, (_, i) => [lon + dx * Math.cos(i * Math.PI / 16), lat + dy * Math.sin(i * Math.PI / 16)]).some(p => !covered(p));
    const stale = now - Date.parse(metadata.sourceDate) > 30 * 86400000;
    const counts = emptyCounts(), weighted = emptyCounts();
    const nearby = this.within([lon - dx, lat - dy, lon + dx, lat + dy]).flatMap(f => {
      const distanceM = distanceToGeometry(lon, lat, f.geometry);
      if (distanceM > range) return [];
      const category = f.properties.category;
      counts[category]++;
      weighted[category] += exposureCategories[category].weight * (distanceM <= radiusM ? 1 : 1 - (distanceM - radiusM) / bufferM);
      return [{...f, properties: {...f.properties, distanceM: Math.round(distanceM)}}];
    }).sort((a, b) => a.properties.distanceM - b.properties.distanceM || a.properties.id.localeCompare(b.properties.id));
    const contributions = (Object.keys(counts) as ExposureCategory[]).map(category => ({category, count: counts[category], points: Math.round(Math.min(exposureCategories[category].cap, weighted[category]) * 10) / 10}));
    const score = Math.min(40, Math.round(contributions.reduce((sum, c) => sum + c.points, 0)));
    return {status: stale ? 'stale' : partial ? 'partial' : 'ready', sourceDate: metadata.sourceDate, importedAt: metadata.importedAt,
      radiusM, bufferM, total: nearby.length, counts, score, uplift: hazardActive ? score : 0, hazardActive, contributions, nearby: nearby.slice(0, 100),
      detail: `Community-mapped features in the zone and a 1 km buffer. Geometry distance; OSM objects, not verified unique facilities. Potential busy places are land-use proxies; occupancy and footfall unknown. ${stale ? 'Inventory older than 30 days. ' : ''}${partial ? 'Extract edge or skipped geometries: partial coverage. ' : ''}Exposure raises review priority only when weather or thermal triggers are present; not a fire probability.`};
  }
}
export function unavailableExposure(radiusM: number, hazardActive: boolean, status: ExposureSummary['status'] = 'unavailable', detail = 'Catalonia exposure inventory unavailable. Import or refresh the server dataset.'): ExposureSummary {
  return {status, sourceDate: null, importedAt: null, radiusM, bufferM: 1000, total: null, counts: null, score: null, uplift: 0, hazardActive, contributions: [], nearby: [], detail};
}
export function exposureReason(exposure: ExposureSummary) {
  return exposure.uplift > 0 ? `Nearby people and infrastructure: +${exposure.uplift}/40 exposure priority (${exposure.total} mapped features; ${exposure.status} inventory). Occupancy unknown.` : null;
}
