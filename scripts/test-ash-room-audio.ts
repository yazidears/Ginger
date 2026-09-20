import assert from 'node:assert/strict';
import {AshRoomAudio} from '../src/components/ash-room-audio';
import type {RoomView,VoicePhase} from '../src/lib/ash-room-types';

async function main(){
  const originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');const originalPeer=globalThis.RTCPeerConnection;
  const actions:string[]=[],errors:string[]=[],phases:VoicePhase[]=[];
  const room={id:'test-room',memberId:'test-operator',floor:{memberId:'test-operator',generation:'test-generation',expiresAt:Date.now()+15000}} as RoomView;
  const request=async(body:Record<string,unknown>)=>{actions.push(String(body.action));return room;};
  const callbacks={phase:(value:VoicePhase)=>phases.push(value),error:(value:string)=>errors.push(value),transcript(){},evidence(){},changed(){}};
  try{
    Object.defineProperty(globalThis,'RTCPeerConnection',{value:class {},configurable:true,writable:true});
    Object.defineProperty(globalThis,'navigator',{value:{mediaDevices:{getUserMedia:async()=>{throw new DOMException('Denied','NotAllowedError');}}},configurable:true});
    const denied=new AshRoomAudio(request,callbacks,()=>room);await denied.start();
    assert.deepEqual(actions,['claim-floor','release-floor']);assert.equal(phases.at(-1),'disconnected');assert.match(errors[0],/permission was denied/);
    assert.equal(denied.sendText('test'),false);await denied.stop();assert.equal(actions.filter(a=>a==='release-floor').length,1);
    actions.length=0;errors.length=0;let resolveMicrophone!:(stream:MediaStream)=>void,tracksStopped=0;
    Object.defineProperty(globalThis,'navigator',{value:{mediaDevices:{getUserMedia:()=>new Promise<MediaStream>(resolve=>{resolveMicrophone=resolve;})}},configurable:true});
    const cancelled=new AshRoomAudio(request,callbacks,()=>room);const starting=cancelled.start();await new Promise(resolve=>setTimeout(resolve,0));await cancelled.stop();resolveMicrophone({getTracks:()=>[{stop(){tracksStopped++;}}]} as unknown as MediaStream);await starting;
    assert.equal(tracksStopped,1);assert.deepEqual(actions,['claim-floor','release-floor']);assert.equal(errors.length,0);
    // Hold a real tool continuation across cancellation without opening media or a provider session.
    for(const mode of ['normal','interrupt','speech','reconnect'] as const){
      const sent:Record<string,unknown>[]=[],evidence:unknown[]=[];let resolveTool!:(value:unknown)=>void;
      const audio=new AshRoomAudio(async()=>new Promise(resolve=>{resolveTool=resolve;}),{...callbacks,evidence:value=>evidence.push(value)},()=>room);
      const internals=audio as unknown as {events:RTCDataChannel;stopping:boolean;attempt:symbol;handleRealtime:(event:Record<string,unknown>)=>Promise<void>};
      internals.attempt=Symbol('test-session');internals.events={readyState:'open',send:(value:string)=>sent.push(JSON.parse(value)),close(){}} as RTCDataChannel;
      const pending=internals.handleRealtime({type:'response.done',response:{output:[{type:'function_call',call_id:'deferred',name:'incident_status',arguments:'{}'}]}});
      if(mode==='interrupt')audio.interrupt();
      if(mode==='speech')await internals.handleRealtime({type:'input_audio_buffer.speech_started'});
      if(mode==='reconnect'){await audio.stop(false);internals.stopping=false;internals.attempt=Symbol('next-session');internals.events={readyState:'open',send:(value:string)=>sent.push(JSON.parse(value)),close(){}} as RTCDataChannel;}
      resolveTool({runId:'test-run'});await pending;
      assert.equal(sent.filter(item=>item.type==='response.create').length,mode==='normal'?1:0,`${mode}: stale tool must not restart speech`);
      assert.equal(sent.filter(item=>item.type==='conversation.item.create').length,mode==='reconnect'?0:1,`${mode}: output stays in its original session`);
      assert.equal(evidence.length,mode==='normal'?1:0,`${mode}: stale tool must not replace current evidence`);
    }
    console.log('PASS Ash audio lifecycle: denied microphone releases room floor; end during permission prompt stops late tracks; no provider session requested; repeated cleanup is safe; deferred tools cannot restart interrupted speech or cross sessions. This unit test does not exercise browser media transport.');
  }finally{if(originalNavigator)Object.defineProperty(globalThis,'navigator',originalNavigator);Object.defineProperty(globalThis,'RTCPeerConnection',{value:originalPeer,configurable:true,writable:true});}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
