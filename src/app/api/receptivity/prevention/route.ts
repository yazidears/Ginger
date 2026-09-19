import {readReceptivity} from '@/lib/receptivity/engine';
import {PREVENTION_METHOD, scorePrevention, validateTeam} from '@/lib/receptivity/prevention';
import {HORIZONS} from '@/lib/receptivity/types';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const response = (data: unknown, status = 200) => Response.json(data, {status, headers: {'Cache-Control': 'no-store'}});

/** Read-only what-if calculation; does not assign or dispatch a team. */
export async function POST(request: Request) {
  if (!request.headers.get('content-type')?.includes('application/json')) return response({error: 'JSON content is required.'}, 415);
  let value: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > 4096) return response({error: 'Request is too large.'}, 413);
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error();
    value = parsed as Record<string, unknown>;
  } catch {return response({error: 'Invalid JSON object.'}, 400);}
  if (Object.keys(value).some(k => !['cellId', 'horizon', 'team', 'humanActivity'].includes(k))) return response({error: 'Unknown scenario field.'}, 400);
  if (typeof value.cellId !== 'string' || !value.cellId || value.cellId.length > 100) return response({error: 'cellId is required.'}, 400);
  const horizon = value.horizon ?? 0;
  if (typeof horizon !== 'number' || !HORIZONS.some(h => h === horizon)) return response({error: 'Unsupported forecast horizon.'}, 400);
  if (value.humanActivity !== undefined && (typeof value.humanActivity !== 'number' || !Number.isFinite(value.humanActivity) || value.humanActivity < 0 || value.humanActivity > 100)) return response({error: 'humanActivity must be 0–100.'}, 400);
  let team;
  try {team = validateTeam(value.team);} catch (error) {return response({error: (error as Error).message}, 400);}
  try {
    const result = await readReceptivity();
    if (!result.snapshot || result.stale) return response({error: 'Fresh receptivity evidence is required.', refreshing: result.refreshing}, 503);
    const cell = result.snapshot.cells.find(c => c.id === value.cellId);
    if (!cell) return response({error: 'Cell not found.'}, 404);
    if (!cell.prevention || !result.snapshot.preventionMethod) return response({error: 'Prevention context is awaiting a backend refresh.'}, 503);
    const scenarioActivity = typeof value.humanActivity === 'number';
    const context = {connectedFuelHa: cell.prevention.connectedFuelHa,
      humanActivity: scenarioActivity ? value.humanActivity as number : cell.prevention.humanActivity,
      humanActivitySource: scenarioActivity ? 'scenario' as const : cell.prevention.humanActivitySource};
    const index = result.snapshot.horizons.indexOf(horizon);
    const score = scorePrevention(cell, context, team, index);
    return response({cellId: cell.id, horizon, generatedAt: result.snapshot.generatedAt,
      validAt: result.snapshot.stations.find(s => s.station.id === cell.stationId)?.frames.find(f => f.horizon === horizon)?.timestamp ?? null,
      method: {...PREVENTION_METHOD, team}, score});
  } catch {return response({error: 'Prevention assessment unavailable.'}, 503);}
}
