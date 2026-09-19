import {authorizeAsh,VoiceError} from '@/lib/ash-voice';
import {validateFix,buildSituation} from '@/lib/ash-situation';
import {readOperations} from '@/lib/operations';
import {assessLocation, validateLocation} from '@/lib/assessment';
import {buildAshReply} from '@/lib/ash';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request) {
  // Bound the actual stream as Content-Length is optional and untrusted.
  const reader = request.body?.getReader();
  if (!reader) return Response.json({error:'JSON body required.'}, {status:400});
  let raw = ''; let bytes = 0; const decoder = new TextDecoder();
  try {
    while (true) { const {done, value} = await reader.read(); if (done) break; bytes += value.byteLength;
      if (bytes > 4096) { await reader.cancel(); return Response.json({error:'Request too large.'}, {status:413}); }
      raw += decoder.decode(value, {stream:true});
    }
    raw += decoder.decode();
    const body = JSON.parse(raw);
    if (!body || typeof body.question !== 'string' || !body.question.trim() || body.question.length > 500 || typeof body.lat !== 'number' || typeof body.lon !== 'number') throw Error();
    validateLocation(body.lat, body.lon);
    let fix;
    if(body.fix!==undefined){
      try{authorizeAsh(request);fix=validateFix(body.fix,body.lat,body.lon);}
      catch(error){return Response.json({error:error instanceof Error?error.message:'Invalid position.'},{status:error instanceof VoiceError?error.status:400});}
    }
    try {
      const assessment = await assessLocation(body.lat, body.lon);
      const reply=buildAshReply(body.question,assessment);
      if(fix){
        const situation=buildSituation(assessment,await readOperations().catch(()=>null));
        const q=body.question.toLowerCase();
        if(/\b(dgps|gps|position|coordinates|where am i|location)\b/.test(q)){
          reply.topic='Current position';reply.answer=`Your device reports latitude ${fix.lat.toFixed(5)}, longitude ${fix.lon.toFixed(5)}, with estimated horizontal accuracy ${Math.round(fix.accuracyM)} metres. Fix time ${fix.observedAt}. Differential GPS corrections are not available.`;
        }else if(/\b(nearby|observation|observations|tasks)\b/.test(q)&&! /\b(safe|route|escape|evacuat\w*)\b/.test(q)){
          reply.topic='Nearby Ginger situation';
          reply.answer=situation.operationsAvailable?`${situation.observations.length} recent unverified operator observations and ${situation.tasks.length} open inspection tasks in the bounded nearby result. ${situation.observations[0]?`Nearest observation, ${situation.observations[0].distanceM} metres straight-line: ${situation.observations[0].text.slice(0,500)}. `:''}These are not verified dispatch instructions.`:'Ginger operator observations are unavailable. No absence of incidents can be inferred.';
        }
        return Response.json({...reply,position:fix,situation},{headers:{'Cache-Control':'no-store'}});
      }
      return Response.json(reply,{headers:{'Cache-Control':'no-store'}});
    } catch { return Response.json({error:'Ginger is unavailable. No current briefing can be verified.'}, {status:503}); }
  } catch { return Response.json({error:'Provide a question (1–500 characters) and numeric lat/lon.'}, {status:400}); }
}
