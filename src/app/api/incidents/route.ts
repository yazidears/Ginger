import {buildIncidentScenario} from '@/lib/incident-scenario';
import {saveScenario} from '@/lib/scenario-store';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return Response.json({error: 'Origin mismatch.'}, {status: 403});
  if (!request.headers.get('content-type')?.includes('application/json')) return Response.json({error: 'Send JSON incident evidence.'}, {status: 415});
  try {
    const reader = request.body?.getReader();
    if (!reader) throw Error('Provide incident evidence.');
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const {value, done} = await reader.read(); if (done) break;
      size += value.length;
      if (size > 32768) {await reader.cancel(); return Response.json({error: 'Incident evidence is too large.'}, {status: 413});}
      chunks.push(value);
    }
    const scenario = await saveScenario(buildIncidentScenario(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
    return Response.json({scenario}, {status: 201, headers: {'Cache-Control': 'no-store'}});
  } catch (error) {
    return Response.json({error: error instanceof Error ? error.message : 'Incident evidence could not be saved.'}, {status: 400});
  }
}
