import {boundedBytes,synthesizeSpeech,voiceRequest,VoiceError} from '@/lib/ash-voice';
export const runtime='nodejs';
export const maxDuration=30;
export async function POST(request:Request) {
  return voiceRequest(request,async config=>{
    let input:unknown;try{input=JSON.parse((await boundedBytes(request.body,20000)).toString());}catch(error){if(error instanceof VoiceError)throw error;throw new VoiceError('Expected JSON speech text.',400);}
    if(!input||typeof input!=='object'||!('text' in input)||typeof input.text!=='string')throw new VoiceError('Expected speech text.',400);
    const audio=await synthesizeSpeech(input.text,config);
    return new Response(new Uint8Array(audio),{headers:{'Content-Type':'audio/wav','Cache-Control':'no-store'}});
  });
}
