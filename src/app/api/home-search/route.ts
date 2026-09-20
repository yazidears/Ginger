import {parseHomeLocations, type HomeLocation} from '@/lib/home-geocoding';
import {requireSameOrigin, WatchAreaError} from '@/lib/watch-areas';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const state = globalThis as typeof globalThis & {gingerHomeSearch?: {last: number; cache: Map<string, {at: number; locations: HomeLocation[]}>}};
const search = state.gingerHomeSearch ??= {last: 0, cache: new Map()};
const reply = (data: unknown, status = 200) => Response.json(data, {status, headers: {'Cache-Control': 'no-store'}});
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    if (!request.headers.get('content-type')?.includes('application/json')) throw new WatchAreaError('JSON content is required.', 415);
    const body = await request.text();
    if (body.length > 1024) throw new WatchAreaError('Address is too long.', 413);
    let value;
    try {value = JSON.parse(body);} catch {throw new WatchAreaError('Invalid search request.');}
    if (typeof value?.query !== 'string' || value.query.trim().length < 5 || value.query.length > 250) throw new WatchAreaError('Enter a street address and town (5–250 characters).');
    const query = value.query.trim(), now = Date.now();
    for (const [key, entry] of search.cache) if (now - entry.at > 15 * 60_000) search.cache.delete(key);
    const cached = search.cache.get(query);
    if (cached) return reply({locations: cached.locations});
    if (now - search.last < 1500) return reply({error: 'Please wait a moment before searching again.'}, 429);
    search.last = now;
    const url = new URL(process.env.GINGER_GEOCODER_URL || 'https://photon.komoot.io/api/');
    url.search = new URLSearchParams({q: query, limit: '6', lang: 'en', lat: '41.39', lon: '2.17'}).toString();
    const response = await fetch(url, {cache: 'no-store', signal: AbortSignal.timeout(10_000), headers: {'User-Agent': 'GingerHomeWatch/1.0'}});
    if (!response.ok) throw new Error('Geocoder unavailable');
    const locations = parseHomeLocations(await response.json());
    if (search.cache.size >= 100) search.cache.delete(search.cache.keys().next().value!);
    search.cache.set(query, {at: now, locations});
    return reply({locations});
  } catch (error) {
    return reply({error: error instanceof WatchAreaError ? error.message : 'Address search is unavailable. Try again or enter coordinates below.'}, error instanceof WatchAreaError ? error.status : 503);
  }
}
