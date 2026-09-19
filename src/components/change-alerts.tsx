'use client';
import {useState} from 'react';
import {EvidenceBadge} from './evidence';
import type {MonitorSnapshot,MonitorZone} from '@/lib/monitor';
export default function ChangeAlerts({monitor,onInspect,acknowledged,onAcknowledge}:{monitor:MonitorSnapshot|null;onInspect:(zone:MonitorZone)=>void;acknowledged:string[];onAcknowledge:(id:string)=>void}){
 const [showHistory,setShowHistory]=useState(false);
 const changes=monitor?.deltas??[];
 const unread=changes.filter(c=>!acknowledged.includes(c.id));
 const visible=showHistory?changes:unread;
 return <section className="change-alerts" aria-label="Change notifications">
  <div className="change-heading"><EvidenceBadge kind="derived"/><h3>What changed <span>{unread.length}</span></h3><button aria-pressed={showHistory} onClick={()=>setShowHistory(v=>!v)}>{showHistory?'Show new':'History'}</button></div>
  <p className="change-summary" role="status" aria-live="polite">{unread.length?`${unread.length} changes to review.`:'No new changes.'} </p>
  {visible.map(c=>{const zone=monitor?.zones.find(z=>z.id===c.zoneId);const read=acknowledged.includes(c.id);return <article className="change-card" key={c.id}>
   <div className="live-alert-meta"><span className="badge watch">{c.kind}</span><time dateTime={c.time}>{new Date(c.time).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'})} UTC</time></div>
   <h4>{c.title}</h4><strong>{c.area}</strong><details><summary>Evidence</summary><p>{c.text}</p></details><div className="change-actions">{zone&&<button onClick={()=>onInspect(zone)}>Inspect sector ↗</button>}{read?<span>Acknowledged</span>:<button onClick={()=>onAcknowledge(c.id)} aria-label={`Acknowledge ${c.title} in ${c.area}`}>Acknowledge</button>}</div>
  </article>;})}
  <details className="change-rules"><summary>What triggers an alert?</summary><p>Wind speed ±5 km/h; direction ≥15° when both readings are ≥5 km/h; temperature ±3°C; humidity ±10 percentage points. Also detection counts, weather-window timing, source availability and review status.</p><p>First scan establishes a baseline. History retains 50 changes while the server runs; acknowledgments are saved in this browser. Live fire-trajectory updates are unavailable until a validated spread feed is connected.</p></details>
 </section>;
}
