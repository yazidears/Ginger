'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {ArrowUp,Check,Copy,Headphones,Mic,MicOff,PhoneOff,Radio,Volume2,X} from 'lucide-react';
import type {RoomView,VoicePhase} from '@/lib/ash-room-types';
import {AshRoomAudio} from './ash-room-audio';
import './ash-room.css';

type CatalogRun={id:string;createdAt:string;lat:number;lon:number;basis:string;horizonMinutes:number};
type Evidence={tool?:string;result?:Record<string,unknown>};
const phaseLabel:Record<VoicePhase,string>={disconnected:'Ready when you are',connecting:'Connecting',listening:'Listening',processing:'Retrieving evidence',speaking:'Ash is speaking',muted:'Microphone muted','room-listening':'Listening to the room'};
function errorText(error:unknown){return error instanceof Error?error.message:'Request failed.';}
function stamp(at:string){return new Date(at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});}
function evidenceSummary(evidence:Evidence){
  const result=evidence.result;if(!result)return 'No evidence retrieved yet.';
  if(result.authorizationRequired)return String(result.message);
  if(evidence.tool==='asset_exposure'){
    const central=result.central as {name:string}[]|undefined;const count=central?.length||0;
    return `${result.exposureStatus==='unavailable'||result.exposureStatus==='outside-coverage'?'Inventory coverage is unavailable':`${count} mapped assets returned with central modelled exposure`} at +${result.minute} min. ${central?.slice(0,3).map(a=>a.name).join(', ')||'No asset names returned.'} Exposure does not establish damage or road closure.`;
  }
  if(evidence.tool==='latest_forecast')return result.changed?'A newer matching forecast is available. Review its basis in Sage; this room remains on the selected run.':'The selected run is the latest completed matching forecast. Review its issue time and assumptions below.';
  if(evidence.tool==='compare_forecasts')return 'Related forecast results retrieved. Differences reflect modelled assumptions; they do not establish assets saved.';
  if(evidence.tool==='operational_history')return 'Room events, pending proposals and nearby operational records retrieved. Field reports remain unverified.';
  return String(result.limitation||'Selected forecast evidence retrieved.');
}

export default function AshRoomWorkspace(){
  const [room,setRoom]=useState<RoomView|null>(null),[phase,setPhase]=useState<VoicePhase>('disconnected'),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [name,setName]=useState(''),[accessToken,setAccessToken]=useState(''),[roomId,setRoomId]=useState(''),[runId,setRunId]=useState(''),[minute,setMinute]=useState(0);
  const [catalog,setCatalog]=useState<CatalogRun[]>([]),[unlocked,setUnlocked]=useState(false),[configured,setConfigured]=useState<boolean|null>(null);
  const [publicDemo,setPublicDemo]=useState(false);
  const [question,setQuestion]=useState(''),[caption,setCaption]=useState(''),[evidence,setEvidence]=useState<Evidence|null>(null),[muted,setMuted]=useState(false),[speakerMuted,setSpeakerMuted]=useState(false);
  const roomRef=useRef<RoomView|null>(null),credential=useRef(''),audio=useRef<AshRoomAudio|null>(null),signalCursor=useRef(0),refreshRef=useRef<()=>void>(()=>{});
  const updateRoom=useCallback((value:RoomView)=>{roomRef.current=value;setRoom(value);},[]);
  const requestRoom=useCallback(async(body:Record<string,unknown>)=>{
    const current=roomRef.current;if(!current)throw Error('Join a room first.');
    const response=await fetch(`/api/ash/rooms/${current.id}`,{method:'POST',headers:{'Content-Type':'application/json',...(credential.current?{Authorization:`Bearer ${credential.current}`}:{})},body:JSON.stringify(body)});
    const data=await response.json();if(!response.ok)throw Error(data.error||'Room request failed.');if(data.memberId)updateRoom(data);return data;
  },[updateRoom]);
  useEffect(()=>{
    audio.current=new AshRoomAudio(requestRoom,{phase:setPhase,error:setError,transcript:setCaption,evidence:value=>setEvidence(value as Evidence),changed:()=>refreshRef.current()},()=>roomRef.current);
    return ()=>{void audio.current?.stop();audio.current=null;};
  },[requestRoom]);
  useEffect(()=>{
    const query=new URLSearchParams(location.search);setRoomId(query.get('room')||'');setRunId(query.get('sageRun')||'');setMinute(Number(query.get('minute'))||0);
    void fetch('/api/ash/rooms').then(r=>r.json()).then(data=>{setConfigured(data.configured);setPublicDemo(data.publicDemo===true);}).catch(()=>setConfigured(false));
    const id=query.get('room');if(!id)return;credential.current=sessionStorage.getItem(`ginger-ash-member:${id}`)||'';
    void fetch(`/api/ash/rooms/${id}`,{headers:credential.current?{Authorization:`Bearer ${credential.current}`}:{}}).then(async response=>{if(response.ok)updateRoom(await response.json());}).catch(()=>{});
  },[updateRoom]);
  useEffect(()=>{
    if(!room?.id)return;let cancelled=false,inFlight=false;let timer:ReturnType<typeof setTimeout>;
    const refresh=async()=>{if(inFlight||cancelled)return;inFlight=true;
      try{const response=await fetch(`/api/ash/rooms/${room.id}?afterSignal=${signalCursor.current}`,{headers:credential.current?{Authorization:`Bearer ${credential.current}`}:{},cache:'no-store'});const next=await response.json();if(!response.ok)throw Error(next.error||'Room connection unavailable.');if(cancelled)return;updateRoom(next);audio.current?.syncRoom(next);audio.current?.receive(next.signals);for(const signal of next.signals)signalCursor.current=Math.max(signalCursor.current,signal.sequence);
      }catch(cause){if(!cancelled)setError(errorText(cause));}finally{inFlight=false;if(!cancelled)timer=setTimeout(refresh,1000);}};
    refreshRef.current=()=>{clearTimeout(timer);void refresh();};void refresh();return ()=>{cancelled=true;clearTimeout(timer);refreshRef.current=()=>{};};
  },[room?.id,updateRoom]);
  async function bootstrap(action:'catalog'|'create'|'join'){
    setBusy(true);setError('');try{
      const response=await fetch('/api/ash/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,accessToken,name,roomId,runId,minute})});const data=await response.json();if(!response.ok)throw Error(data.error||'Unable to join.');
      if(action==='catalog'){setCatalog(data.runs);setUnlocked(true);if(!runId&&data.runs[0])setRunId(data.runs[0].id);}
      else{credential.current=data.memberToken;sessionStorage.setItem(`ginger-ash-member:${data.room.id}`,data.memberToken);setAccessToken('');updateRoom(data.room);signalCursor.current=0;history.replaceState(null,'',`/ash?room=${data.room.id}&sageRun=${data.room.runId}&minute=${data.room.minute}`);}
    }catch(cause){setError(errorText(cause));}finally{setBusy(false);}
  }
  async function ask(event:React.FormEvent){event.preventDefault();if(!question.trim())return;setError('');const text=question.trim();setQuestion('');if(audio.current?.sendText(text))return;
    setBusy(true);try{setEvidence(await requestRoom({action:'ask',question:text,callId:crypto.randomUUID()}) as Evidence);refreshRef.current();}catch(cause){setError(errorText(cause));}finally{setBusy(false);}
  }
  async function confirm(id:string,decision:'approve'|'reject'){setBusy(true);setError('');try{await requestRoom({action:'confirm',proposalId:id,decision,confirmation:`${decision}:${id}`});refreshRef.current();}catch(cause){setError(errorText(cause));}finally{setBusy(false);}}
  async function leave(){setError('');await audio.current?.stop();await requestRoom({action:'leave'}).catch(()=>{});if(room)sessionStorage.removeItem(`ginger-ash-member:${room.id}`);credential.current='';roomRef.current=null;setRoom(null);setUnlocked(false);setRoomId('');history.replaceState(null,'','/ash');}
  const floorMember=room?.members.find(m=>m.id===room.floor?.memberId),ownFloor=room?.floor?.memberId===room?.memberId,connected=phase!=='disconnected'&&phase!=='connecting';
  return <main className="ash-room-app">
    {!room?<section className="ash-entry">
      <div className="ash-eyebrow"><Radio size={15}/> ASH · OPERATIONS</div>
      <h1>One room.<br/>A shared picture.</h1>
      <p>Talk through a Sage forecast with your team.</p>
      {configured===false&&<p className="ash-notice">Operator room access is not configured on this server.</p>}
      <form onSubmit={event=>{event.preventDefault();void bootstrap(roomId?'join':unlocked?'create':'catalog');}}>
        <label>Your name<input value={name} onChange={event=>setName(event.target.value)} maxLength={60} autoComplete="name" placeholder="Operator name" required/></label>
        {!publicDemo&&<label>Operator access token<input type="password" value={accessToken} onChange={event=>setAccessToken(event.target.value)} autoComplete="off" placeholder="Server-issued access token" required/></label>}
        {roomId?<label>Room<input value={roomId} onChange={event=>setRoomId(event.target.value)} maxLength={36} required/></label>:unlocked?<label>Sage forecast<select value={runId} onChange={event=>setRunId(event.target.value)} required><option value="">Select a saved forecast</option>{catalog.map(run=><option value={run.id} key={run.id}>{run.basis} · {run.lat.toFixed(3)}, {run.lon.toFixed(3)} · {new Date(run.createdAt).toLocaleString()}</option>)}</select></label>:null}
        {unlocked&&!catalog.length&&!roomId&&<p className="ash-notice">No completed forecast is available. <Link href="/sage">Create one in Sage</Link>.</p>}
        <button className="ash-primary" disabled={busy||configured===false}>{busy?'Connecting…':roomId?'Join room':unlocked?'Open room':'Continue'}</button>
      </form>
      <details className="ash-join-existing"><summary>Join another room</summary><label>Room ID<input value={roomId} onChange={event=>setRoomId(event.target.value)} placeholder="Paste room ID" maxLength={36}/></label></details>
      {error&&<p role="alert" className="ash-error">{error}</p>}
      <small>{publicDemo?'Public demo · hypothetical scenarios. No real alerts or emergency commands.':'Authorised operators only. No public messages or emergency commands.'}</small>
    </section>:<>
      <header className="ash-room-header"><div><span className="ash-eyebrow">ASH · SHARED OPERATIONS</span><h1>{room.name}</h1><p>{room.basis==='confirmed-incident'?'Operator-confirmed incident':'Hypothetical scenario'} <span>·</span> <Link href={`/sage?sageRun=${room.runId}&minute=${room.minute}`}>Run {room.runId?.slice(0,8)} ↗</Link> <span>·</span> +{room.minute} min{room.forecastIssuedAt&&<> <span>·</span> Issued {new Date(room.forecastIssuedAt).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</>}</p></div><div className="ash-room-actions"><button onClick={()=>void navigator.clipboard.writeText(`${location.origin}/ash?room=${room.id}`).then(()=>setError('Room link copied. Participants still need an operator token.')).catch(()=>setError('Copy the room URL from the address bar.'))}><Copy size={14}/> Share room</button><button onClick={()=>void leave()}>Leave</button></div></header>
      <div className="ash-room-grid">
        <section className="ash-conversation" aria-label="Voice conversation">
          <div className={`ash-voice-orb ${phase}`} aria-hidden="true"><Radio size={38}/></div>
          <span className="ash-voice-state" role="status">{phaseLabel[phase]}</span>
          <p className="ash-voice-context">{floorMember?`${floorMember.name} has the microphone`:'Ask what changed, what is exposed, or what needs checking.'}</p>
          <div className="ash-voice-controls">
            {phase==='disconnected'&&(!room.floor||ownFloor)?<button className="ash-primary" disabled={!room.voiceConfigured} onClick={()=>{setError('');void audio.current?.start();}}><Mic size={18}/> Start voice</button>:null}
            {room.floor&&!ownFloor&&phase==='disconnected'?<button className="ash-primary" onClick={()=>{setError('');void audio.current?.listen().catch(cause=>setError(errorText(cause)));}}><Headphones size={18}/> Listen to room</button>:null}
            {connected&&ownFloor?<><button aria-pressed={muted} onClick={()=>{audio.current?.setMuted(!muted);setMuted(!muted);}}>{muted?<MicOff size={18}/>:<Mic size={18}/>} {muted?'Unmute':'Mute'}</button><button onClick={()=>audio.current?.interrupt()}>Interrupt</button></>:null}
            {phase!=='disconnected'?<button onClick={()=>{void audio.current?.stop();setMuted(false);}}><PhoneOff size={17}/> End audio</button>:null}
            <button aria-pressed={!speakerMuted} onClick={()=>{if(speakerMuted){void audio.current?.enableSpeaker().catch(cause=>setError(errorText(cause)));setSpeakerMuted(false);}else{audio.current?.muteSpeaker(true);setSpeakerMuted(true);}}}><Volume2 size={17}/>{speakerMuted?'Enable speaker':'Speaker on'}</button>
          </div>
          {!room.voiceConfigured&&<p className="ash-notice">Voice is not configured. Evidence lookup is available.</p>}
          <div className="ash-caption" aria-live="polite">{caption||'Ash retrieves evidence from the selected Sage run.'}</div>
          {error&&<p className="ash-error" role="alert">{error}<button aria-label="Dismiss message" onClick={()=>setError('')}><X size={14}/></button></p>}
          <form className="ash-question" onSubmit={ask}><label className="ash-sr-only" htmlFor="ash-question">Ask Ash or look up evidence</label><input id="ash-question" value={question} onChange={event=>setQuestion(event.target.value)} placeholder={connected&&ownFloor?'Or type to Ash…':'Look up forecast evidence…'} maxLength={1000}/><button disabled={busy||!question.trim()} aria-label="Send question"><ArrowUp size={20}/></button></form>
          <p className="ash-input-caption">{connected&&ownFloor?'Same voice session · tool-grounded answers':'Text fallback · scoped evidence retrieval'}</p>
          {evidence&&<article className="ash-evidence"><div className="ash-eyebrow">RETRIEVED EVIDENCE · {String(evidence.result?.runId||room.runId).slice(0,8)}</div><p>{evidenceSummary(evidence)}</p><details><summary>Evidence & assumptions</summary><pre>{JSON.stringify(evidence.result,null,2)}</pre></details></article>}
        </section>
        <aside className="ash-room-feed">
          <div className="ash-participants"><span className="ash-eyebrow">IN THE ROOM</span><div>{room.members.filter(member=>Date.now()-Date.parse(member.seenAt)<90000).map(member=><span key={member.id} className={member.id===room.floor?.memberId?'speaking':''}>{member.id===room.floor?.memberId?<Mic size={12}/>:<span className="ash-member-dot"/>}{member.name}{member.id===room.memberId?' (you)':''}</span>)}</div></div>
          {room.proposals.filter(p=>p.status==='pending'||p.status==='failed'||p.status==='executing').map(proposal=><article className="ash-proposal" key={proposal.id}><span className="ash-eyebrow">{proposal.status==='failed'?'ACTION FAILED':proposal.status==='executing'?'APPROVAL RECORDED':'REQUIRES YOUR APPROVAL'}</span><h2>{proposal.kind==='field-report'?'Unverified field report':proposal.kind==='new-run'?'New Sage run':'Draft review task'}</h2><p>{proposal.text}</p><small>Run {proposal.runId.slice(0,8)} · Proposed by {proposal.createdBy}</small>{proposal.status==='executing'&&<p>Execution is pending or was interrupted. Check operational records before requesting this again.</p>}{proposal.error&&<p className="ash-error">{proposal.error}</p>}{proposal.status==='pending'&&<div><button className="ash-primary" disabled={busy} onClick={()=>void confirm(proposal.id,'approve')}><Check size={14}/> Approve {proposal.kind==='new-run'?'run':proposal.kind==='field-report'?'report':'draft'}</button><button disabled={busy} onClick={()=>void confirm(proposal.id,'reject')}>Decline</button></div>}</article>)}
          <details className="ash-network-details"><summary>Audio connection</summary><p>{room.audioNetwork==='relay-configured'?'A network relay is configured for team audio.':'Team audio uses peer connections on the same network. A TURN relay is required for reliable access across different networks.'}</p></details><div className="ash-feed-heading"><span className="ash-eyebrow">ROOM UPDATES</span><span>Shared</span></div>
          <ol>{[...room.events].reverse().slice(0,30).map(event=><li key={event.id}><time dateTime={event.at}>{stamp(event.at)}</time><div><p>{event.summary}</p><small>{event.actor}{event.verification==='unverified'?' · Unverified':''}{event.runId&&<> · <Link href={`/sage?sageRun=${event.runId}&minute=${event.minute||0}`}>Run {event.runId.slice(0,8)}</Link></>}</small></div></li>)}</ol>
        </aside>
      </div>
    </>}
  </main>;
}
