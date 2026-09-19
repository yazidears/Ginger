import {readExposureIndex} from '@/lib/exposure/store';
import {exposureCategories, type ExposureCategory} from '@/lib/exposure/types';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Viewport-bounded geometry. Scoring always uses the full server index, never this capped map response. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get('bbox') || '0,40.4,3.5,42.9';
  const box = raw.split(',').map(Number);
  if (box.length !== 4 || raw.split(',').some(s => !s.trim()) || !box.every(Number.isFinite) || box[0] >= box[2] || box[1] >= box[3] || box[0] < -180 || box[2] > 180 || box[1] < -85 || box[3] > 85) return Response.json({error: 'Invalid viewport bounds'}, {status: 400});
  const categories = [...new Set((url.searchParams.get('categories') || Object.keys(exposureCategories).join(',')).split(','))];
  if (categories.some(c => !Object.hasOwn(exposureCategories,c))) return Response.json({error: 'Invalid category'}, {status: 400});
  try {
    const index = await readExposureIndex();
    // Clamp viewport before enumerating grid cells, including world-sized requests.
    const clipped: [number, number, number, number] = [Math.max(-1, box[0]), Math.max(39, box[1]), Math.min(5, box[2]), Math.min(44, box[3])];
    const matching = clipped[0] <= clipped[2] && clipped[1] <= clipped[3] ? index.within(clipped).filter(f => categories.includes(f.properties.category)) : [];
    // Round-robin categories ensures roads cannot crowd out schools and hospitals.
    const groups = categories.map(c => matching.filter(f => f.properties.category === c as ExposureCategory));
    const features = [];
    for (let i = 0; features.length < 5000 && groups.some(g => i < g.length); i++) for (const group of groups) if (group[i] && features.length < 5000) features.push(group[i]);
    const metadata = index.data.metadata;
    return Response.json({type: 'FeatureCollection', features, total: matching.length, truncated: matching.length > features.length,
      status: Date.now() - Date.parse(metadata.sourceDate) > 30 * 86400000 ? 'stale' : metadata.skipped ? 'partial' : 'ready', metadata}, {headers: {'Cache-Control': 'no-store'}});
  } catch {return Response.json({type: 'FeatureCollection', features: [], total: null, truncated: false, status: 'unavailable', error: 'Catalonia exposure inventory is not available on this server.'}, {status: 503});}
}
