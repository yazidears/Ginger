import {requireSameOrigin, watchAreaStore, WatchAreaError} from '@/lib/watch-areas';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const response = (data: unknown, status = 200) => Response.json(data, {status, headers: {'Cache-Control': 'no-store'}});
function failure(error: unknown) {
  return response({error: error instanceof WatchAreaError ? error.message : 'Watch-area storage is unavailable. Existing data has not been reset.'}, error instanceof WatchAreaError ? error.status : 503);
}
export async function GET() {
  try { return response({areas: await watchAreaStore.list()}); } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    if (!request.headers.get('content-type')?.includes('application/json')) throw new WatchAreaError('JSON content is required.', 415);
    const text = await request.text();
    if (text.length > 4096) throw new WatchAreaError('Request is too large.', 413);
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new WatchAreaError('Invalid JSON.'); }
    return response({area: await watchAreaStore.add(value)}, 201);
  } catch (error) { return failure(error); }
}
export async function DELETE(request: Request) {
  try { requireSameOrigin(request); await watchAreaStore.remove(new URL(request.url).searchParams.get('id') ?? ''); return response({ok: true}); }
  catch (error) { return failure(error); }
}
