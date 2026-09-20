import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {buildDirectScenario, buildPreventContext, type CapturedForecast} from '@/lib/product-context';
import {saveScenario} from '@/lib/scenario-store';
import {requireSameOrigin, WatchAreaError} from '@/lib/watch-areas';
import type {Snapshot} from '@/lib/receptivity/types';
import type {EvidenceRecord} from '@/lib/product-contracts';
import {readRegionalSnapshot} from '@/lib/regional-snapshot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const response = (value: unknown, status = 200) => Response.json(value, {status, headers: {'Cache-Control': 'no-store'}});
async function preparedSnapshot(): Promise<Snapshot> {
  try { return JSON.parse(await readFile(join(process.env.GINGER_RECEPTIVITY_DIR || join(process.cwd(), '.ginger-data/receptivity'), 'latest.json'), 'utf8')); }
  catch { throw new WatchAreaError('Prepared environmental evidence is unavailable. Try again after the data worker completes.', 503); }
}
async function capturedForecast(snapshot: Snapshot, cellId: string): Promise<CapturedForecast | undefined> {
  const cell = snapshot.cells.find(item => item.id === cellId);
  if (!cell?.stationId) return;
  const hash = createHash('sha256').update(`forecast-v2:${cell.stationId}`).digest('hex');
  try {
    const cache = JSON.parse(await readFile(join(process.env.GINGER_RECEPTIVITY_DIR || join(process.cwd(), '.ginger-data/receptivity'), `${hash}.json`), 'utf8'));
    if (cache.value?.weather && Number.isFinite(cache.at)) return {...cache.value, retrievedAt: new Date(cache.at).toISOString()};
  } catch { /* Sparse prepared frames remain explicit; no new provider request or silent substitution. */ }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    if (!request.headers.get('content-type')?.includes('application/json')) throw new WatchAreaError('JSON is required.', 415);
    const reader = request.body?.getReader(); if (!reader) throw new WatchAreaError('Request body is required.');
    let bytes = 0; const parts: Uint8Array[] = [];
    while (true) { const {value, done} = await reader.read(); if (done) break; bytes += value.length; if (bytes > 4096) {await reader.cancel(); throw new WatchAreaError('Scenario request is too large.', 413);} parts.push(value); }
    const value = JSON.parse(Buffer.concat(parts).toString('utf8'));
    let scenario;
    if (typeof value.cellId === 'string') {
      if (value.cellId.length > 100 || typeof value.horizon !== 'number') throw new WatchAreaError('A cell and environmental horizon are required.');
      const snapshot = await preparedSnapshot();
      scenario = buildPreventContext(snapshot, value.cellId, value.horizon, Date.now(), await capturedForecast(snapshot, value.cellId));
    } else if (typeof value.thermalId === 'string') {
      const regional = await readRegionalSnapshot('catalonia');
      const signal = regional.hotspots.find(item => item.id === value.thermalId);
      if (!signal) throw new WatchAreaError('That thermal observation is no longer in the regional evidence snapshot. Refresh the evidence first.', 409);
      scenario = buildDirectScenario({lat: signal.position[1], lon: signal.position[0], name: 'Thermal observation · hypothetical exploration', ignitionAt: signal.provenance.observedAt});
      const evidence: EvidenceRecord = {id: signal.id, source: signal.provenance.source, kind: 'observed', observedAt: signal.provenance.observedAt, validAt: signal.provenance.observedAt, retrievedAt: regional.retrievedAt, extent: [signal.position[0], signal.position[1], signal.position[0], signal.position[1]], resolutionM: null, crs: 'EPSG:4326', units: 'thermal anomaly', coverage: 'unknown', status: Date.now() - Date.parse(signal.provenance.observedAt) > 6 * 3600000 ? 'stale' : 'available', detail: `Unverified thermal observation; confidence ${signal.confidence}. Not an ignition time or a confirmed wildfire.`, consumers: ['Sage hypothetical ignition location']};
      scenario.evidence = [evidence];
      scenario.incident = {id: signal.id, name: 'Unverified thermal observation', source: signal.provenance.source, observedAt: signal.provenance.observedAt, confirmation: 'unverified', confirmationBasis: 'Satellite thermal observation only; no independent incident confirmation.', geometry: {type: 'Point', coordinates: signal.position}, evidence: [evidence]};
      scenario.assumptions = ['Hypothetical ignition located at the thermal observation and its acquisition time. Neither ignition location nor ignition time is confirmed.'];
    } else {
      if (typeof value.lat !== 'number' || typeof value.lon !== 'number' || (value.ignitionAt !== undefined && typeof value.ignitionAt !== 'string') || (value.name !== undefined && typeof value.name !== 'string')) throw new WatchAreaError('Numeric coordinates and an optional valid ignition time are required.');
      scenario = buildDirectScenario(value);
    }
    return response({scenario: await saveScenario(scenario)}, 201);
  } catch (error) {
    const status = error instanceof WatchAreaError ? error.status : error instanceof SyntaxError ? 400 : (error as NodeJS.ErrnoException).code ? 503 : 400;
    return response({error: status === 503 ? 'Scenario storage or prepared evidence is unavailable.' : error instanceof Error ? error.message : 'Invalid scenario request.'}, status);
  }
}
