import 'server-only';
import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export type WatchArea = { id: string; name: string; lat: number; lon: number; radiusM: number; createdAt: string };
export class WatchAreaError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const defaults = [
  ['garraf', 'Garraf', 41.3, 1.86], ['penedes', 'Alt Penedès', 41.35, 1.69],
  ['bages', 'Bages', 41.73, 1.83], ['montseny', 'Montseny', 41.76, 2.4],
  ['ebre', 'Terres de l’Ebre', 40.82, .52], ['emporda', 'Alt Empordà', 42.27, 2.96],
] as const;
export function validateWatchArea(value: unknown): Pick<WatchArea, 'name' | 'lat' | 'lon' | 'radiusM'> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WatchAreaError('Expected an area object.');
  const {name, lat, lon, radiusM} = value as Record<string, unknown>;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80 || /[\u0000-\u001f\u007f<>]/.test(name)) throw new WatchAreaError('Name must contain 1–80 plain-text characters.');
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90 || typeof lon !== 'number' || !Number.isFinite(lon) || lon < -180 || lon > 180) throw new WatchAreaError('Valid numeric latitude and longitude are required.');
  if (typeof radiusM !== 'number' || !Number.isInteger(radiusM) || radiusM < 500 || radiusM > 10000) throw new WatchAreaError('Radius must be an integer between 500 and 10000 metres.');
  return {name: name.trim(), lat, lon, radiusM};
}
const globalQueues = globalThis as typeof globalThis & { gingerWatchQueues?: Map<string, Promise<unknown>> };
const queues = globalQueues.gingerWatchQueues ??= new Map();
/** One Node server process; atomic replacement protects against partial files, not multi-host writes. */
export function createWatchAreaStore(file: string) {
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = (queues.get(file) ?? Promise.resolve()).catch(() => {}).then(operation);
    queues.set(file, next.catch(() => {}));
    return next;
  }
  async function save(areas: WatchArea[]) {
    await mkdir(dirname(file), {recursive: true, mode: 0o700});
    const temp = `${file}.${randomUUID()}.tmp`;
    try { await writeFile(temp, JSON.stringify({version: 1, areas}, null, 2), {mode: 0o600, flag: 'wx'}); await rename(temp, file); }
    finally { await unlink(temp).catch(() => {}); }
  }
  async function read(): Promise<WatchArea[]> {
    let raw: string;
    try { raw = await readFile(file, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const createdAt = new Date().toISOString();
      const areas = defaults.map(([id, name, lat, lon]) => ({id, name, lat, lon, radiusM: 10000, createdAt}));
      await save(areas); return areas;
    }
    const data = JSON.parse(raw);
    if (data.version !== 1 || !Array.isArray(data.areas) || data.areas.length > 20) throw new Error('Invalid watch-area storage.');
    const seen = new Set<string>();
    return data.areas.map((area: WatchArea) => {
      const valid = validateWatchArea(area);
      if (typeof area.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(area.id) || seen.has(area.id) || typeof area.createdAt !== 'string' || !Number.isFinite(Date.parse(area.createdAt))) throw new Error('Invalid stored watch area.');
      seen.add(area.id); return {...valid, id: area.id, createdAt: area.createdAt};
    });
  }
  return {
    list: () => serial(read),
    add: (value: unknown) => serial(async () => {
      const valid = validateWatchArea(value), areas = await read();
      if (areas.length >= 20) throw new WatchAreaError('Maximum of 20 watch areas reached.', 409);
      const area = {...valid, id: randomUUID(), createdAt: new Date().toISOString()};
      await save([...areas, area]); return area;
    }),
    remove: (id: string) => serial(async () => {
      if (!/^[a-zA-Z0-9-]{1,64}$/.test(id)) throw new WatchAreaError('Invalid watch-area ID.');
      const areas = await read();
      if (!areas.some(area => area.id === id)) throw new WatchAreaError('Watch area not found.', 404);
      await save(areas.filter(area => area.id !== id));
    }),
  };
}
export const watchAreaStore = createWatchAreaStore(join(process.cwd(), '.ginger-data', 'watch-areas.json'));
/** Browser origin guard; this is not authentication. */
export function requireSameOrigin(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new WatchAreaError('Same-origin requests are required.', 403);
}
