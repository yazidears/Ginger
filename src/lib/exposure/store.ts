import {readFile, stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {ExposureIndex, coordinates, unavailableExposure} from './model';
import {exposureCategories, type ExposureDataset} from './types';
let saved: {key: string; index: ExposureIndex} | undefined;
let pending: Promise<ExposureIndex> | undefined;
export async function readExposureIndex(): Promise<ExposureIndex> {
  if (pending) return pending;
  pending = (async () => {
    const path = resolve(process.env.GINGER_EXPOSURE_FILE || '.ginger-data/exposure/catalonia.geojson');
    const info = await stat(path), key = `${path}:${info.mtimeMs}:${info.size}`;
    if (saved?.key === key) return saved.index;
    const data = JSON.parse(await readFile(path, 'utf8')) as ExposureDataset;
    if (data.type !== 'FeatureCollection' || data.metadata?.version !== 1 || !Array.isArray(data.features) || !data.features.length ||
        !Number.isFinite(Date.parse(data.metadata.sourceDate)) || Date.parse(data.metadata.sourceDate) > Date.now() + 86400000 ||
        !Number.isFinite(Date.parse(data.metadata.importedAt)) || data.metadata.coverage?.type !== 'MultiPolygon' || !data.metadata.coverage.coordinates.length) throw Error('Invalid exposure inventory');
    const ids = new Set<string>();
    for (const f of data.features) {
      if (f.type !== 'Feature' || !f.properties || !Object.hasOwn(exposureCategories,f.properties.category) || !f.properties.id || ids.has(f.properties.id) ||
          !['Point','LineString','Polygon','MultiPolygon'].includes(f.geometry?.type)) throw Error('Invalid exposure feature');
      const points = coordinates(f.geometry);
      if (!points.length || points.some(p => !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || p[0] < -1 || p[0] > 5 || p[1] < 39 || p[1] > 44)) throw Error('Invalid Catalonia geometry');
      ids.add(f.properties.id);
    }
    const index = new ExposureIndex(data); saved = {key, index}; return index;
  })();
  try {return await pending;} finally {pending = undefined;}
}
export async function readExposure(lon: number, lat: number, radiusM: number, hazardActive: boolean) {
  try {return (await readExposureIndex()).summary(lon, lat, radiusM, hazardActive);}
  catch {return unavailableExposure(radiusM, hazardActive);}
}
