/** Explicit, bounded provider check. Creates an exercise room, reads one real run, and requests one spoken answer.
 * Run only when provider usage is authorised: node --conditions=react-server --import tsx scripts/check-ash-realtime.ts
 * No microphone capture, public messaging or operational writes. Credentials are never logged.
 */
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {loadEnvConfig} from '@next/env';
loadEnvConfig(process.cwd(),false,{info(){},error(){}});
const require=createRequire(import.meta.url);
const WebSocket=require('next/dist/compiled/ws');
const origin=process.env.ASH_CHECK_ORIGIN||'http://localhost:3050';
const currentSource=process.env.ASH_CHECK_CURRENT_SOURCE==='1';
const prompt=process.env.ASH_CHECK_PROMPT||'Which forecast are we using?';
const runId=process.env.ASH_CHECK_RUN_ID||'f2f68d3d-da0d-4c58-9872-369a2eded87e';
async function json(url:string,body:unknown,token?:string){const response=await fetch(origin+url,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});const data=await response.json();if(!response.ok)throw Error(data.error||`HTTP ${response.status}`);return data;}
async function main(){
  const a=await json('/api/ash/rooms',{action:'create',accessToken:process.env.GINGER_ASH_ROOM_TOKEN||process.env.ASH_ACCESS_TOKEN,name:'API verification operator',roomName:'Realtime verification exercise',runId,minute:30});
  const url=`/api/ash/rooms/${a.room.id}`;let b:{memberToken:string}|undefined;
  try{
    b=await json('/api/ash/rooms',{action:'join',accessToken:process.env.GINGER_ASH_ROOM_TOKEN||process.env.ASH_ACCESS_TOKEN,name:'API verification observer',roomId:a.room.id});
    await json(url,{action:'claim-floor'},a.memberToken);
    const {changeRoom}=await import('../src/lib/ash-room-store');
    const secret=currentSource?await changeRoom(a.room.id,async room=>(await import('../src/lib/ash-realtime')).createAshRealtimeSecret(room,a.room.memberId)):await json(url,{action:'session'},a.memberToken);
    let audioBytes=0,transcript='',toolCalls=0,toolRun='';const toolEvidence:{name:string;minute?:number;exposureStatus?:string;counts?:unknown}[]=[];
    await new Promise<void>((resolve,reject)=>{
      const ws=new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(secret.model)}`,{headers:{Authorization:`Bearer ${secret.value}`}});
      const timer=setTimeout(()=>{ws.close();reject(Error('Realtime verification exceeded 45 seconds.'));},45000);
      const finish=(error?:Error)=>{clearTimeout(timer);ws.close();error?reject(error):resolve();};
      ws.on('error',()=>finish(Error('Realtime transport failed.')));
      ws.on('open',()=>{ws.send(JSON.stringify({type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_text',text:prompt}]}}));ws.send(JSON.stringify({type:'response.create',response:{output_modalities:['text'],tool_choice:{type:'function',name:'incident_status'}}}));});
      ws.on('message',async(buffer:Buffer)=>{
        try{const event=JSON.parse(buffer.toString());if(event.type==='error'){finish(Error(event.error?.message||'Realtime rejected the session.'));return;}
          if(event.type==='response.output_audio.delta')audioBytes+=Buffer.from(event.delta,'base64').length;
          if(event.type==='response.output_audio_transcript.delta')transcript+=event.delta;
          if(event.type==='response.done'){
            const calls=(event.response?.output||[]).filter((item:{type:string})=>item.type==='function_call');
            for(const call of calls){if(++toolCalls>3)throw Error('Verification tool-call limit exceeded.');const result=currentSource?{result:await changeRoom(a.room.id,async room=>(await import('../src/lib/ash-room-tools')).executeAshTool(room,a.room.memberId,call.name,JSON.parse(call.arguments)))}:await json(url,{action:'tool',name:call.name,args:JSON.parse(call.arguments),callId:call.call_id},a.memberToken);toolRun=result.result?.runId;toolEvidence.push({name:call.name,minute:result.result?.minute,exposureStatus:result.result?.exposureStatus,counts:result.result?.counts});ws.send(JSON.stringify({type:'conversation.item.create',item:{type:'function_call_output',call_id:call.call_id,output:JSON.stringify(result)}}));}
            if(calls.length)ws.send(JSON.stringify({type:'response.create'}));else if(toolCalls&&audioBytes)finish();else if(event.response?.status==='failed')finish(Error('Realtime response failed.'));
          }
        }catch(error){finish(error instanceof Error?error:Error('Realtime verification failed.'));}
      });
    });
    const observed=await fetch(origin+url,{headers:{Authorization:`Bearer ${b!.memberToken}`}}).then(r=>r.json());
    assert.equal(toolRun,runId);assert.ok(toolCalls>0);assert.ok(audioBytes>0);assert.ok(observed.events.some((event:{kind:string;runId:string;minute:number})=>event.kind==='tool'&&event.runId===runId&&event.minute===30));
    console.log(JSON.stringify({provider:'OpenAI Realtime',currentSource,prompt,model:secret.model,transport:'server WebSocket check; browser uses WebRTC',runId,minute:30,toolCalls,toolEvidence,spokenAudioBytes:audioBytes,transcript,secondClientSawGroundedEvent:true,microphoneCaptureTested:false,peerAudioDistributionTested:false}));
  }finally{await json(url,{action:'release-floor'},a.memberToken).catch(()=>{});await json(url,{action:'leave'},a.memberToken).catch(()=>{});if(b)await json(url,{action:'leave'},b.memberToken).catch(()=>{});}
}
void main().catch(error=>{console.error(error.message);process.exitCode=1;});
