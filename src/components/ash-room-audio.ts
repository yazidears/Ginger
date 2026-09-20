import type {RoomSignal, RoomView, VoicePhase} from '@/lib/ash-room-types';

type RequestRoom=(body:Record<string,unknown>)=>Promise<unknown>;
type Callbacks={phase:(phase:VoicePhase)=>void; error:(message:string)=>void; transcript:(text:string)=>void; evidence:(value:unknown)=>void; changed:()=>void};
function message(error:unknown){return error instanceof Error?error.message:'Audio connection failed.';}
async function gather(peer:RTCPeerConnection){
  if(peer.iceGatheringState==='complete')return;
  await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{peer.removeEventListener('icegatheringstatechange',listen);reject(Error('Audio connection timed out while gathering network candidates.'));},10000);const listen=()=>{if(peer.iceGatheringState==='complete'){clearTimeout(timer);peer.removeEventListener('icegatheringstatechange',listen);resolve();}};peer.addEventListener('icegatheringstatechange',listen);listen();});
}

/** One Realtime connection per leased microphone floor; its mixed audio fans out to room listeners. */
export class AshRoomAudio {
  private realtime:RTCPeerConnection|null=null;
  private events:RTCDataChannel|null=null;
  private microphone:MediaStream|null=null;
  private context:AudioContext|null=null;
  private mix:MediaStreamAudioDestinationNode|null=null;
  private sources:MediaStreamAudioSourceNode[]=[];
  private peers=new Map<string,RTCPeerConnection>();
  private speakers:HTMLAudioElement[]=[];
  private doneCalls=new Set<string>();
  private generation:string|null=null;
  private heldFloor=false;
  private muted=false;
  private stopping=false;
  private speakerEnabled=true;
  private caption='';
  private signalQueue:Promise<void>=Promise.resolve();
  private attempt:symbol|null=null;
  private responseEpoch=0;
  constructor(private request:RequestRoom,private callbacks:Callbacks,private current:()=>RoomView|null){}
  private send(value:unknown){if(this.events?.readyState==='open')this.events.send(JSON.stringify(value));}
  private attachAudio(stream:MediaStream){const audio=new Audio();audio.autoplay=true;audio.muted=!this.speakerEnabled;audio.srcObject=stream;this.speakers.push(audio);void audio.play().catch(()=>this.callbacks.error('Speaker playback was blocked. Select “Enable speaker” to hear the room.'));}
  async enableSpeaker(){this.speakerEnabled=true;await this.context?.resume();for(const audio of this.speakers){audio.muted=false;await audio.play();}}
  muteSpeaker(muted:boolean){this.speakerEnabled=!muted;for(const audio of this.speakers)audio.muted=muted;}
  async start(){
    if(this.realtime)throw Error('End the current session before reconnecting.');
    this.stopping=false;const attempt=Symbol('voice');this.attempt=attempt;this.callbacks.phase('connecting');
    const current=()=>this.attempt===attempt;
    try{
      if(!navigator.mediaDevices?.getUserMedia||typeof RTCPeerConnection==='undefined')throw Error('This browser cannot start voice. Use evidence lookup below.');
      const claimed=await this.request({action:'claim-floor'}) as RoomView;if(!current()){await this.request({action:'release-floor'}).catch(()=>{});return;}this.generation=claimed.floor?.generation||null;this.heldFloor=true;
      try{const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});if(!current()){stream.getTracks().forEach(track=>track.stop());return;}this.microphone=stream;}catch(error){throw Error(error instanceof DOMException&&error.name==='NotAllowedError'?'Microphone permission was denied. Allow it in your browser or use evidence lookup.':'No usable microphone is available. Use evidence lookup.');}
      this.context=new AudioContext();await this.context.resume();this.mix=this.context.createMediaStreamDestination();
      const input=this.context.createMediaStreamSource(this.microphone);input.connect(this.mix);this.sources.push(input);
      const peer=new RTCPeerConnection();this.realtime=peer;for(const track of this.microphone.getAudioTracks())peer.addTrack(track,this.microphone);
      peer.ontrack=event=>{const stream=event.streams[0]||new MediaStream([event.track]);this.attachAudio(stream);if(this.context&&this.mix){const source=this.context.createMediaStreamSource(stream);source.connect(this.mix);this.sources.push(source);}};
      peer.onconnectionstatechange=()=>{if(peer.connectionState==='failed'||peer.connectionState==='disconnected'){this.callbacks.error('Voice disconnected. Ended this session; reconnect when ready.');void this.stop();}};
      const channel=peer.createDataChannel('oai-events');this.events=channel;channel.onopen=()=>{this.callbacks.phase('listening');this.callbacks.changed();this.send({type:'response.create',response:{output_modalities:['text'],tool_choice:{type:'function',name:'incident_status'}}});};channel.onclose=()=>{if(!this.stopping){this.callbacks.error('Voice connection closed. Reconnect when ready.');void this.stop();}};
      channel.onmessage=event=>{try{void this.handleRealtime(JSON.parse(event.data));}catch{this.callbacks.error('An unreadable voice event was received.');}};
      const credential=await this.request({action:'session'}) as {value:string};
      if(!current())return;
      await peer.setLocalDescription(await peer.createOffer());await gather(peer);
      if(!current())return;
      const response=await fetch('https://api.openai.com/v1/realtime/calls',{method:'POST',headers:{Authorization:`Bearer ${credential.value}`,'Content-Type':'application/sdp'},body:peer.localDescription?.sdp,signal:AbortSignal.timeout(20000)});
      if(!response.ok)throw Error(`Voice connection failed (${response.status}). Evidence lookup remains available.`);
      const sdp=await response.text();if(!current())return;await peer.setRemoteDescription({type:'answer',sdp});
    }catch(error){if(current()){await this.stop();this.callbacks.error(message(error));}}
  }
  private async handleRealtime(event:Record<string,unknown>){
    if(this.stopping)return;
    if(event.type==='input_audio_buffer.speech_started'){this.responseEpoch++;this.caption='';this.callbacks.transcript('');this.callbacks.phase(this.muted?'muted':'listening');}
    if(event.type==='input_audio_buffer.speech_stopped'||event.type==='response.created')this.callbacks.phase('processing');
    if(event.type==='output_audio_buffer.started')this.callbacks.phase('speaking');
    if(event.type==='output_audio_buffer.stopped')this.callbacks.phase(this.muted?'muted':'listening');
    if(event.type==='response.output_audio_transcript.delta'&&typeof event.delta==='string'){this.caption+=event.delta;this.callbacks.transcript(this.caption);}
    if(event.type==='response.created'){this.caption='';this.callbacks.transcript('');}
    if(event.type==='error'){const error=event.error as {message?:string;code?:string}|undefined;if(error?.code!=='response_cancel_not_active')this.callbacks.error(error?.message||'Voice service reported an error.');}
    if(event.type==='response.done'){
      const channel=this.events,attempt=this.attempt,epoch=this.responseEpoch;
      const sameSession=()=>!this.stopping&&this.events===channel&&this.attempt===attempt;
      const currentResponse=()=>sameSession()&&this.responseEpoch===epoch;
      const response=event.response as {output?:{type:string;call_id:string;name:string;arguments:string}[];status?:string;status_details?:{error?:{message?:string}}}|undefined;
      const calls=response?.output?.filter(item=>item.type==='function_call'&&!this.doneCalls.has(item.call_id))||[];
      for(const call of calls){
        this.doneCalls.add(call.call_id);this.callbacks.phase('processing');let output:unknown;
        try{const args=JSON.parse(call.arguments);output=await this.request({action:'tool',callId:call.call_id,name:call.name,args});if(currentResponse()){this.callbacks.evidence(output);this.callbacks.changed();}}catch(error){output={error:message(error),unavailable:true};}
        if(!sameSession())return;
        // Resolve the original call, but cancellation must not start another spoken response.
        this.send({type:'conversation.item.create',item:{type:'function_call_output',call_id:call.call_id,output:JSON.stringify(output)}});
      }
      if(calls.length&&currentResponse())this.send({type:'response.create'});
      if(currentResponse()&&response?.status==='failed')this.callbacks.error(response.status_details?.error?.message||'Voice response failed. Try evidence lookup.');
    }
  }
  sendText(text:string){if(this.events?.readyState!=='open')return false;this.send({type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_text',text}]}});this.send({type:'response.create'});return true;}
  setMuted(muted:boolean){this.muted=muted;for(const track of this.microphone?.getAudioTracks()||[])track.enabled=!muted;this.callbacks.phase(muted?'muted':'listening');}
  interrupt(){this.responseEpoch++;this.send({type:'response.cancel'});this.send({type:'output_audio_buffer.clear'});this.callbacks.phase(this.muted?'muted':'listening');}
  async listen(){
    const room=this.current();if(!room?.floor)throw Error('No one has the microphone yet. Start a voice session or wait for a participant.');if(room.floor.memberId===room.memberId)return;
    const id=room.floor.memberId;this.peers.get(id)?.close();this.callbacks.phase('connecting');this.generation=room.floor.generation;
    const peer=new RTCPeerConnection({iceServers:room.iceServers});this.peers.set(id,peer);peer.addTransceiver('audio',{direction:'recvonly'});
    peer.ontrack=event=>{this.attachAudio(event.streams[0]||new MediaStream([event.track]));this.callbacks.phase('room-listening');};
    peer.onconnectionstatechange=()=>{if(peer.connectionState==='failed'){this.callbacks.phase('disconnected');this.callbacks.error('Room audio cannot connect across this network. Try the same network; room events remain available.');}};
    await peer.setLocalDescription(await peer.createOffer());await gather(peer);await this.request({action:'signal',to:id,description:peer.localDescription?.toJSON()});
  }
  receive(signals:RoomSignal[]){for(const signal of signals)this.signalQueue=this.signalQueue.then(()=>this.handleSignal(signal)).catch(error=>this.callbacks.error(message(error)));}
  private async handleSignal(signal:RoomSignal){
    const room=this.current();if(!room?.floor||signal.to!==room.memberId)return;
    if(signal.description.type==='offer'&&room.floor.memberId===room.memberId&&this.mix){
      this.peers.get(signal.from)?.close();const peer=new RTCPeerConnection({iceServers:room.iceServers});this.peers.set(signal.from,peer);for(const track of this.mix.stream.getAudioTracks())peer.addTrack(track,this.mix.stream);
      await peer.setRemoteDescription(signal.description);await peer.setLocalDescription(await peer.createAnswer());await gather(peer);await this.request({action:'signal',to:signal.from,description:peer.localDescription?.toJSON()});
    }else if(signal.description.type==='answer'){const peer=this.peers.get(signal.from);if(peer?.signalingState==='have-local-offer')await peer.setRemoteDescription(signal.description);}
  }
  syncRoom(room:RoomView){if(this.generation&&room.floor?.generation!==this.generation){this.callbacks.error('The microphone floor changed. Voice disconnected; join the current conversation again.');void this.stop(false);}}
  async stop(release=true){
    this.stopping=true;this.responseEpoch++;this.attempt=null;const owned=this.heldFloor;this.heldFloor=false;this.generation=null;
    this.events?.close();this.events=null;this.realtime?.close();this.realtime=null;
    for(const track of this.microphone?.getTracks()||[])track.stop();this.microphone=null;
    for(const peer of this.peers.values())peer.close();this.peers.clear();for(const source of this.sources)source.disconnect();this.sources=[];
    for(const audio of this.speakers){audio.pause();audio.srcObject=null;}this.speakers=[];await this.context?.close().catch(()=>{});this.context=null;this.mix=null;this.doneCalls.clear();this.muted=false;
    this.callbacks.phase('disconnected');if(release&&owned)await this.request({action:'release-floor'}).catch(()=>{});this.callbacks.changed();
  }
}
