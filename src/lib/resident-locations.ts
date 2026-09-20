import 'server-only';
import {parseHomeLocations, type HomeLocation} from './home-geocoding';
import {validateWatchArea, watchAreaStore, WatchAreaError, type WatchArea} from './watch-areas';

// A bounded Catalonia search envelope, not an administrative-boundary determination.
export const inResidentRegion = (lat: number, lon: number) => Number.isFinite(lat) && Number.isFinite(lon)
  && lat >= 40.4 && lat <= 42.9 && lon >= 0.1 && lon <= 3.4;

type LocationStore = {add: (value: unknown, requestId?: string) => Promise<WatchArea>};
export function createResidentLocations(options: {store?: LocationStore; fetch?: typeof fetch; now?: () => number; geocoderUrl?: string} = {}) {
  const cache = new Map<string, {at: number; locations: HomeLocation[]}>();
  let lastSearch = -Infinity;
  const now = options.now ?? Date.now;
  return async (value: unknown): Promise<{locations: HomeLocation[]} | {area: WatchArea}> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WatchAreaError('Expected a location request.');
    const input = value as Record<string, unknown>;
    if (input.action === 'add') {
      if (typeof input.requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(input.requestId)) throw new WatchAreaError('Invalid location request ID.');
      const area = validateWatchArea({...input, placeType: input.placeType ?? 'home'});
      if (!inResidentRegion(area.lat, area.lon)) throw new WatchAreaError('Choose a location within the Catalonia search region.');
      return {area: await (options.store ?? watchAreaStore).add(area, input.requestId)};
    }
    if (input.action !== 'search') throw new WatchAreaError('Choose search or add.');
    if (typeof input.query !== 'string' || input.query.trim().length < 5 || input.query.length > 250 || /[\u0000-\u001f\u007f<>]/.test(input.query)) throw new WatchAreaError('Enter a street address and town (5–250 plain-text characters).');
    const query = input.query.trim(), at = now();
    for (const [key, entry] of cache) if (at - entry.at > 15 * 60_000) cache.delete(key);
    const cached = cache.get(query);
    if (cached) return {locations: cached.locations};
    if (at - lastSearch < 1500) throw new WatchAreaError('Please wait a moment before searching again.', 429);
    lastSearch = at;
    const url = new URL(options.geocoderUrl ?? process.env.GINGER_GEOCODER_URL ?? 'https://photon.komoot.io/api/');
    url.search = new URLSearchParams({q: query, limit: '6', lang: 'en', lat: '41.39', lon: '2.17', bbox: '0.1,40.4,3.4,42.9'}).toString();
    const response = await (options.fetch ?? fetch)(url, {cache: 'no-store', signal: AbortSignal.timeout(10_000), headers: {'User-Agent': 'GingerHomeWatch/1.0'}});
    if (!response.ok) throw new Error('Geocoder unavailable');
    const locations = parseHomeLocations(await response.json()).filter(place => inResidentRegion(place.lat, place.lon)).map(place => ({...place, label: place.label.replace(/[\u0000-\u001f\u007f<>]/g, ' ').trim()})).filter(place => place.label);
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(query, {at, locations});
    return {locations};
  };
}

export const residentLocations = createResidentLocations();
