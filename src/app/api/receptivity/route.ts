import {readReceptivity} from '@/lib/receptivity/engine';
import {mapSnapshot} from '@/lib/receptivity/map-snapshot';
import type {Snapshot} from '@/lib/receptivity/types';
export const runtime='nodejs';
export const dynamic='force-dynamic';
let cachedSource: Snapshot | null = null;
let cachedMap: Snapshot | null = null;
export async function GET(request: Request) {
 const result = await readReceptivity();
 const mapView = new URL(request.url).searchParams.get('view') === 'map';
 const etag = result.snapshot ? `"${result.snapshot.generatedAt}:${result.stale}:${result.error||''}:${mapView?'map':'full'}"` : null;
 const headers = {...(etag ? {ETag: etag} : {}), 'Cache-Control': 'no-cache', 'Retry-After': result.snapshot ? '60' : '8'};
 if (etag && request.headers.get('if-none-match') === etag) return new Response(null, {status:304, headers});
 if (mapView && result.snapshot) {
  if (cachedSource !== result.snapshot) {cachedSource = result.snapshot; cachedMap = mapSnapshot(result.snapshot);}
  return Response.json({...result, snapshot: cachedMap}, {headers});
 }
 return Response.json(result, {status:result.snapshot?200:202, headers});
}
