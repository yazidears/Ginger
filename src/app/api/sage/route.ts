import {assessLocation} from '@/lib/assessment';
import {parseQuestion} from '@/lib/sage/analysis';
import {reasonAboutLocation, sageConfiguration} from '@/lib/sage/reasoning';
export const runtime = 'nodejs';
export const maxDuration = 90;
const headers = {'Cache-Control': 'no-store'};
const gate = globalThis as typeof globalThis & {sageRequests?: {active: number; starts: number[]}};
const limits = gate.sageRequests ??= {active: 0, starts: []};
export function GET() {
  const {configured, model} = sageConfiguration();
  return Response.json({configured, model: configured ? model : null}, {headers});
}
export async function POST(request: Request) {
  // The prototype is single-operator. Keep paid calls same-origin and bounded per process.
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return Response.json({error: 'Use Sage from this workspace.'}, {status: 403, headers});
  let question;
  try {
    if (Number(request.headers.get('content-length')) > 64000) return Response.json({error: 'Conversation is too large.'}, {status: 413, headers});
    const reader = request.body?.getReader();
    if (!reader) throw Error();
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 64000) { await reader.cancel(); return Response.json({error: 'Conversation is too large.'}, {status: 413, headers}); }
      chunks.push(value);
    }
    question = parseQuestion(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } catch { return Response.json({error: 'Provide valid coordinates, a question and a conversation of at most six exchanges.'}, {status: 400, headers}); }
  if (!sageConfiguration().configured) return Response.json({error: 'Sage AI is not connected. Configure OPENAI_API_KEY on the server to enable analysis.', code: 'not_configured'}, {status: 503, headers});
  limits.starts = limits.starts.filter(t => Date.now() - t < 60000);
  if (limits.active >= 2 || limits.starts.length >= 6) return Response.json({error: 'Sage is busy. Try again in a minute.'}, {status: 429, headers: {...headers, 'Retry-After': '60'}});
  limits.active++; limits.starts.push(Date.now());
  try {
    const assessment = await assessLocation(question.lat, question.lon);
    if (request.signal.aborted) return new Response(null, {status: 499});
    return Response.json(await reasonAboutLocation(question, assessment, request.signal), {headers});
  } catch { return Response.json({error: 'Sage could not complete the analysis. Your evidence panels remain available; please retry.'}, {status: 502, headers}); }
  finally { limits.active--; }
}
