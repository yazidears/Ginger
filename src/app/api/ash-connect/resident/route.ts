import {messagingWorker, newResidentSession, residentCookie, residentSession} from '@/lib/ash-connect';
import {requireSameOrigin, watchAreaStore, WatchAreaError} from '@/lib/watch-areas';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (data: unknown, status = 200, cookie?: string) => Response.json(data, {status, headers: {'Cache-Control': 'no-store', ...(cookie ? {'Set-Cookie': cookie} : {})}});
type Registration = {areaId: string; subscribed: boolean; enhanced: boolean; code?: string; expiresAt: number};
async function registrations(session: string): Promise<Registration[]> {
  const response = await messagingWorker('POST', {action: 'resident-status', session});
  if (!response.ok) throw Error('The messaging connection is unavailable. Try again shortly.');
  return (await response.json()).registrations;
}
export async function GET(request: Request) {
  const session = residentSession(request);
  if (!session) return json({homes: []});
  try {
    const pairs = await registrations(session), areas = await watchAreaStore.list();
    return json({homes: pairs.flatMap(pair => {
      const area = areas.find(a => a.id === pair.areaId);
      return area ? [{id: area.id, name: area.name, placeType: area.placeType, ...pair}] : [];
    })});
  } catch {return json({error: 'Your saved connections are temporarily unavailable. Try again shortly.'}, 503);}
}
export async function POST(request: Request) {
  let created: string | undefined;
  const session = residentSession(request) || newResidentSession();
  try {
    requireSameOrigin(request);
    if (!request.headers.get('content-type')?.includes('application/json')) return json({error: 'JSON is required.'}, 415);
    const raw = await request.text();
    if (raw.length > 4096) return json({error: 'Request is too large.'}, 413);
    let input;
    try {input = JSON.parse(raw);} catch {return json({error: 'Invalid request.'}, 400);}
    if (!input || typeof input !== 'object' || Array.isArray(input)) return json({error: 'Invalid request.'}, 400);
    // Check the worker before allocating one of the demo registry's bounded places.
    const pairs = await registrations(session);
    let area;
    if ('areaId' in input) {
      if (!pairs.some(p => p.areaId === input.areaId)) return json({error: 'This place does not belong to this browser.'}, 404);
      area = (await watchAreaStore.list()).find(a => a.id === input.areaId);
      if (!area) return json({error: 'This place is no longer available.'}, 404);
    } else {
      area = await watchAreaStore.add(input); created = area.id;
    }
    const response = await messagingWorker('POST', {action: 'pair', session, areaId: area.id, repeat: area.placeType === 'school' || area.placeType === 'hospital'});
    if (!response.ok) throw Error('Connection could not be prepared. Try again shortly.');
    const pair = await response.json();
    return json({home: {id: area.id, name: area.name, placeType: area.placeType, ...pair}}, 201, residentCookie(request, session));
  } catch (error) {
    if (created) await watchAreaStore.remove(created).catch(() => {});
    return json({error: error instanceof WatchAreaError ? error.message : 'Connection could not be prepared. Try again shortly.'}, error instanceof WatchAreaError ? error.status : 503);
  }
}
