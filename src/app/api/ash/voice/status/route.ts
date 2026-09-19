import {voiceRequest} from '@/lib/ash-voice';
export const runtime='nodejs';
export async function GET(request:Request){return voiceRequest(request,async config=>Response.json({configured:true,provider:'slng',gateway:config.base,stt:'slng/deepgram/nova:3-en',tts:'slng/deepgram/aura:2-en',language:'en',credentialVerified:false},{headers:{'Cache-Control':'no-store'}}));}
