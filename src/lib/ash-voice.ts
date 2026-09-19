import {timingSafeEqual} from 'node:crypto';

export class VoiceError extends Error { constructor(message:string, public status=502) { super(message); } }
export function voiceConfig() {
  const key=process.env.SLNG_API_KEY?.trim();
  const token=process.env.ASH_ACCESS_TOKEN?.trim();
  const base=process.env.SLNG_BASE_URL?.trim() || 'https://us-east.api.slng.ai';
  if(!['https://us-east.api.slng.ai','https://us-west.api.slng.ai'].includes(base)) throw new VoiceError('SLNG hosted English models require the configured US East or US West gateway.',503);
  if(!key || !token || token.length<32) throw new VoiceError('Configure SLNG_API_KEY and ASH_ACCESS_TOKEN (at least 32 characters) on the Ginger server.',503);
  return {key,token,base,voice:process.env.SLNG_VOICE?.trim() || 'aura-2-thalia-en'};
}
export function authorizeAsh(request:Request) {
  const token=process.env.ASH_ACCESS_TOKEN?.trim();
  if(!token||token.length<32)throw new VoiceError('Configure ASH_ACCESS_TOKEN (at least 32 characters) on Ginger.',503);
  const supplied=request.headers.get('authorization')?.replace(/^Bearer /,'') || '';
  const a=Buffer.from(supplied),b=Buffer.from(token);
  if(a.length!==b.length || !timingSafeEqual(a,b)) throw new VoiceError('An Ash access token is required.',401);
}
export function authorizeVoice(request:Request) { authorizeAsh(request);return voiceConfig(); }
export async function boundedBytes(body:ReadableStream<Uint8Array>|null,limit:number) {
  if(!body) throw new VoiceError('Request body required.',400);
  const reader=body.getReader(); const chunks:Uint8Array[]=[];let length=0;
  while(true){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>limit){await reader.cancel();throw new VoiceError('Audio or request exceeds the size limit.',413);}chunks.push(value);}
  return Buffer.concat(chunks);
}
export function wavSampleRate(audio:Buffer) {
  if(audio.length<44 || audio.toString('ascii',0,4)!=='RIFF' || audio.toString('ascii',8,12)!=='WAVE' || audio.toString('ascii',12,16)!=='fmt ' || audio.readUInt32LE(16)!==16 || audio.readUInt16LE(20)!==1 || audio.readUInt16LE(22)!==1 || audio.readUInt16LE(34)!==16 || audio.toString('ascii',36,40)!=='data') throw new VoiceError('Expected mono 16-bit PCM WAV.',400);
  const rate=audio.readUInt32LE(24),size=audio.readUInt32LE(40);
  if(![8000,16000,24000,32000,44100,48000].includes(rate)||size!==audio.length-44||size%2||size<rate/5||size>rate*2*16)throw new VoiceError('Invalid WAV length or sample rate.',400);
  return rate;
}
type Config=ReturnType<typeof voiceConfig>;
async function slng(config:Config,path:string,init:RequestInit,fetcher:typeof fetch) {
  let response:Response;
  try {response=await fetcher(config.base+path,{...init,headers:{...init.headers,Authorization:`Bearer ${config.key}`},signal:AbortSignal.timeout(25000),cache:'no-store',redirect:'error'});}
  catch {throw new VoiceError('SLNG connection failed or timed out.');}
  if(!response.ok)throw new VoiceError(`SLNG request failed (${response.status}). Check provider configuration.`);
  return response;
}
export async function transcribeAudio(audio:Buffer,config:Config,fetcher:typeof fetch=fetch) {
  const sampleRate=wavSampleRate(audio);
  const form=new FormData();form.set('audio',new Blob([new Uint8Array(audio)],{type:'audio/wav'}),'utterance.wav');form.set('language','en');form.set('sample_rate',String(sampleRate));form.set('channels','1');form.set('punctuate','true');
  const response=await slng(config,'/v1/stt/slng/deepgram/nova:3-en',{method:'POST',body:form},fetcher);
  const data=JSON.parse((await boundedBytes(response.body,100000)).toString()) as {results?:{channels?:{alternatives?:{transcript?:unknown}[]}[]}};
  const transcript=data.results?.channels?.[0]?.alternatives?.[0]?.transcript;
  if(typeof transcript!=='string' || transcript.length>2000)throw new VoiceError('SLNG returned an invalid transcript.');
  return transcript.trim();
}
export async function synthesizeSpeech(text:string,config:Config,fetcher:typeof fetch=fetch) {
  if(!text.trim()||text.length>4000)throw new VoiceError('Speech text must be 1–4000 characters.',400);
  const response=await slng(config,'/v1/tts/slng/deepgram/aura:2-en',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,model:config.voice,encoding:'linear16',container:'wav',sample_rate:24000})},fetcher);
  const data=await boundedBytes(response.body,8_000_000);
  if(data.length<44||data.toString('ascii',0,4)!=='RIFF'||data.toString('ascii',8,12)!=='WAVE')throw new VoiceError('SLNG returned invalid speech audio.');
  return data;
}
const limits=globalThis as typeof globalThis & {ashVoiceLimit?:{start:number;count:number;active:number}};
export async function voiceRequest(request:Request,action:(config:Config)=>Promise<Response>) {
  try {
    const config=authorizeVoice(request);
    const state=limits.ashVoiceLimit??={start:Date.now(),count:0,active:0};
    if(Date.now()-state.start>=60000){state.start=Date.now();state.count=0;}
    if(state.count>=120||state.active>=8)throw new VoiceError('Voice service busy. Retry shortly.',429);
    state.count++;state.active++;
    try{return await action(config);}finally{state.active--;}
  }catch(error){return Response.json({error:error instanceof VoiceError?error.message:'Voice service unavailable.'},{status:error instanceof VoiceError?error.status:502,headers:{'Cache-Control':'no-store'}});}
}
