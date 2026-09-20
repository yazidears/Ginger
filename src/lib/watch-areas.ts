import 'server-only';
import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export type WatchArea = { id: string; name: string; lat: number; lon: number; radiusM: number; createdAt: string; placeType?: 'home' | 'school' | 'hospital' };
export class WatchAreaError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const defaults = [
  ['garraf', 'Garraf', 41.3, 1.86], ['penedes', 'Alt Penedès', 41.35, 1.69],
  ['bages', 'Bages', 41.73, 1.83], ['montseny', 'Montseny', 41.76, 2.4],
  ['ebre', 'Terres de l’Ebre', 40.82, .52], ['emporda', 'Alt Empordà', 42.27, 2.96],
] as const;
export function validateWatchArea(value: unknown): Pick<WatchArea, 'name' | 'lat' | 'lon' | 'radiusM' | 'placeType'> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WatchAreaError('Expected an area object.');
  const {name, lat, lon, radiusM, placeType} = value as Record<string, unknown>;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80 || /[\u0000-\u001f\u007f<>]/.test(name)) throw new WatchAreaError('Name must contain 1–80 plain-text characters.');
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90 || typeof lon !== 'number' || !Number.isFinite(lon) || lon < -180 || lon > 180) throw new WatchAreaError('Valid numeric latitude and longitude are required.');
  if (typeof radiusM !== 'number' || !Number.isInteger(radiusM) || radiusM < 500 || radiusM > 10000) throw new WatchAreaError('Radius must be an integer between 500 and 10000 metres.');
  if (placeType !== undefined && (typeof placeType !== 'string' || !['home', 'school', 'hospital'].includes(placeType))) throw new WatchAreaError('Choose a home, school or hospital.');
  return {name: name.trim(), lat, lon, radiusM, ...(placeType ? {placeType: placeType as WatchArea['placeType']} : {})};
}
const globalQueues = globalThis as typeof globalThis & { gingerWatchQueues?: Map<string, Promise<unknown>> };
const queues = globalQueues.gingerWatchQueues ??= new Map();
type AreaRequest = {key: string; fingerprint: string; areaId: string};
type AreaState = {areas: WatchArea[]; requests: AreaRequest[]};
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
/** One Node server process; atomic replacement protects against partial files, not multi-host writes. */
export function createWatchAreaStore(file: string) {
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = (queues.get(file) ?? Promise.resolve()).catch(() => {}).then(operation);
    queues.set(file, next.catch(() => {}));
    return next;
  }
  async function save({areas, requests}: AreaState) {
    await mkdir(dirname(file), {recursive: true, mode: 0o700});
    const temp = `${file}.${randomUUID()}.tmp`;
    try { await writeFile(temp, JSON.stringify({version: 1, areas, ...(requests.length ? {requests} : {})}, null, 2), {mode: 0o600, flag: 'wx'}); await rename(temp, file); }
    finally { await unlink(temp).catch(() => {}); }
  }
  async function read(): Promise<AreaState> {
    let raw: string;
    try { raw = await readFile(file, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const createdAt = new Date().toISOString();
      const areas = defaults.map(([id, name, lat, lon]) => ({id, name, lat, lon, radiusM: 10000, createdAt}));
      const state = {areas, requests: []}; await save(state); return state;
    }
    const data = JSON.parse(raw);
    if (data.version !== 1 || !Array.isArray(data.areas) || data.areas.length > 20) throw new Error('Invalid watch-area storage.');
    const seen = new Set<string>();
    const areas = data.areas.map((area: WatchArea) => {
      const valid = validateWatchArea(area);
      if (typeof area.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(area.id) || seen.has(area.id) || typeof area.createdAt !== 'string' || !Number.isFinite(Date.parse(area.createdAt))) throw new Error('Invalid stored watch area.');
      seen.add(area.id); return {...valid, id: area.id, createdAt: area.createdAt};
    });
    const requests = data.requests === undefined ? [] : data.requests;
    if (!Array.isArray(requests) || requests.length > 1000) throw new Error('Invalid watch-area request storage.');
    const requestKeys = new Set<string>();
    for (const item of requests) {
      if (!item || typeof item !== 'object' || typeof item.key !== 'string' || !/^[a-f0-9]{64}$/.test(item.key)
        || typeof item.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(item.fingerprint)
        || typeof item.areaId !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(item.areaId) || requestKeys.has(item.key)) throw new Error('Invalid watch-area request storage.');
      requestKeys.add(item.key);
    }
    return {areas, requests};
  }
  return {
    list: () => serial(async () => (await read()).areas),
    add: (value: unknown, requestId?: string) => serial(async () => {
      if (requestId !== undefined && (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(requestId))) throw new WatchAreaError('Invalid location request ID.');
      const valid = validateWatchArea(value), state = await read(), {areas, requests} = state;
      const requestKey = requestId === undefined ? null : digest(requestId), fingerprint = digest(JSON.stringify(valid));
      const previous = requestKey ? requests.find(item => item.key === requestKey) : undefined;
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new WatchAreaError('This request ID belongs to a different location.', 409);
        const area = areas.find(item => item.id === previous.areaId);
        if (!area) throw new WatchAreaError('This location was removed. Start a new registration.', 409);
        return area;
      }
      if (requestKey && requests.length >= 1000) throw new WatchAreaError('Location request archive is full.', 409);
      if (areas.length >= 20) throw new WatchAreaError('Maximum of 20 watch areas reached.', 409);
      const area = {...valid, id: randomUUID(), createdAt: new Date().toISOString()};
      // The location and retry receipt commit together; a restart cannot allocate a second place.
      await save({areas: [...areas, area], requests: requestKey ? [...requests, {key: requestKey, fingerprint, areaId: area.id}] : requests}); return area;
    }),
    remove: (id: string) => serial(async () => {
      if (!/^[a-zA-Z0-9-]{1,64}$/.test(id)) throw new WatchAreaError('Invalid watch-area ID.');
      const {areas, requests} = await read();
      if (!areas.some(area => area.id === id)) throw new WatchAreaError('Watch area not found.', 404);
      // Keep retry receipts after removal so an old request never recreates a deleted place.
      await save({areas: areas.filter(area => area.id !== id), requests});
    }),
  };
}
export const watchAreaStore = createWatchAreaStore(join(process.cwd(), '.ginger-data', 'watch-areas.json'));
/** Browser origin guard; this is not authentication. */
export function requireSameOrigin(request: Request) {
  const target = new URL(request.url), rawOrigin = request.headers.get('origin');
  let origin: URL;
  try {origin = new URL(rawOrigin ?? '');} catch {throw new WatchAreaError('Same-origin requests are required.', 403);}
  // Next may use its internal bind address in request.url. Host is the browser-facing
  // authority; do not trust arbitrary X-Forwarded-Host/Proto headers here.
  const host = request.headers.get('host') ?? target.host;
  if (origin.origin !== rawOrigin || origin.host !== host || origin.protocol !== target.protocol || request.headers.get('sec-fetch-site') === 'cross-site') throw new WatchAreaError('Same-origin requests are required.', 403);
}
