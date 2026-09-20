import {operatorAuthorized} from '@/lib/ash-connect';
import {residentLocations} from '@/lib/resident-locations';
import {WatchAreaError} from '@/lib/watch-areas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (data: unknown, status = 200) => Response.json(data, {status, headers: {'Cache-Control': 'no-store'}});

/** Server-to-server only. Never add this route to the resident proxy allowlist. */
export async function POST(request: Request) {
  if (!operatorAuthorized(request)) return json({error: 'Operator access required.'}, 401);
  try {
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new WatchAreaError('JSON is required.', 415);
    const reader = request.body?.getReader();
    if (!reader) throw new WatchAreaError('A request body is required.');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const {done, value} = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 4096) {await reader.cancel(); throw new WatchAreaError('Request is too large.', 413);}
        chunks.push(value);
      }
    } finally {reader.releaseLock();}
    let value: unknown;
    try {value = JSON.parse(Buffer.concat(chunks).toString('utf8'));}
    catch {throw new WatchAreaError('Invalid JSON request.');}
    return json(await residentLocations(value));
  } catch (error) {
    return json({error: error instanceof WatchAreaError ? error.message : 'Location service is unavailable. Retry with the same request ID.'}, error instanceof WatchAreaError ? error.status : 503);
  }
}
