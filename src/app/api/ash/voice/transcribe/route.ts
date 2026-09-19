import {boundedBytes,transcribeAudio,voiceRequest,VoiceError} from '@/lib/ash-voice';
export const runtime='nodejs';
export const maxDuration=30;
export async function POST(request:Request) {
  return voiceRequest(request,async config=>{
    if(request.headers.get('content-type')?.split(';')[0]!=='audio/wav')throw new VoiceError('Content-Type must be audio/wav.',415);
    const transcript=await transcribeAudio(await boundedBytes(request.body,1_536_044),config);
    return Response.json({transcript,provider:'slng',model:'slng/deepgram/nova:3-en'},{headers:{'Cache-Control':'no-store'}});
  });
}
