export type PlaceType = 'home' | 'school' | 'hospital';
export type HomeLocation = {label: string; lat: number; lon: number; placeType?: PlaceType};

/** Keep only usable point results; an address match still needs human pin confirmation. */
export function parseHomeLocations(raw: unknown): HomeLocation[] {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as {features?: unknown}).features)) throw new Error('Invalid geocoder response');
  return (raw as {features: unknown[]}).features.slice(0, 6).flatMap(feature => {
    if (!feature || typeof feature !== 'object') return [];
    const {geometry, properties} = feature as {geometry?: {type?: string; coordinates?: unknown[]}; properties?: Record<string, unknown>};
    const [lon, lat] = geometry?.coordinates ?? [];
    if (geometry?.type !== 'Point' || typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) return [];
    const p = properties ?? {};
    const street = [p.street, p.housenumber].filter(v => typeof v === 'string').join(' ');
    const label = [...new Set([p.name, street, p.postcode, p.city, p.state, p.country].filter(v => typeof v === 'string' && v))].join(', ').slice(0, 400);
    // Classify only an explicit provider tag, never guess from address text.
    const placeType = p.osm_key === 'amenity' && (p.osm_value === 'school' || p.osm_value === 'hospital') ? p.osm_value : undefined;
    return label ? [{label, lat, lon, ...(placeType ? {placeType} : {})}] : [];
  });
}
