'use client';
import {assessmentOpportunity} from '@/lib/prevention-opportunity';
import {OpportunityScore} from './prevention-opportunities';
import WildfireReferences from './wildfire-references';
import {useEffect,useRef,useState} from 'react';
import type {Assessment} from '@/lib/assessment';
import type {PreparedArea} from '@/lib/prepared-workspace';
import type {OperationLocation,OperationsState} from '@/lib/operations';
import {buildPreventionPlan} from '@/lib/prevention-plan';
export default function PreventionPlan({location,onTasks,onCompare,prepared}:{prepared?:PreparedArea|null;location:OperationLocation;onTasks:()=>void;onCompare:()=>void}){
 const [assessment,setAssessment]=useState<Assessment|null>(null),[error,setError]=useState(''),[queueError,setQueueError]=useState(''),[saved,setSaved]=useState<string[]>([]),[busy,setBusy]=useState<string|null>(null),[retry,setRetry]=useState(0),[queueReady,setQueueReady]=useState(false);
 const locationKey=`${location.lat},${location.lon}`;
 const currentLocation=useRef(locationKey);currentLocation.current=locationKey;
 useEffect(()=>{
  const c=new AbortController();setAssessment(null);setError('');setQueueError('');setSaved([]);setBusy(null);setQueueReady(false);
  const signal=()=>AbortSignal.any([c.signal,AbortSignal.timeout(22000)]);
  const loadEvidence=async()=>{
   try{
    let a:Assessment;
    if(prepared)a=prepared.assessment;
    else{const r=await fetch(`/api/assessment?lat=${location.lat}&lon=${location.lon}`,{signal:signal()});if(!r.ok)throw Error('Could not load current evidence.');a=await r.json();}
    if(!c.signal.aborted)setAssessment(a);
   }catch(e){if(!c.signal.aborted)setError(e instanceof Error&&e.name==='TimeoutError'?'Evidence request timed out.':e instanceof Error?e.message:'Could not load current evidence.');}
  };
  const loadQueue=async()=>{
   try{
    const r=await fetch('/api/operations',{signal:signal(),cache:'no-store'});if(!r.ok)throw Error();
    const o:OperationsState=await r.json();
    if(!c.signal.aborted){setSaved(o.tasks.filter(t=>t.status!=='completed'&&t.location.lat===location.lat&&t.location.lon===location.lon).flatMap(t=>t.planId?[t.planId]:[]));setQueueReady(true);}
   }catch{if(!c.signal.aborted)setQueueError('Saved tasks could not be checked. You can review the plan; retry to enable task creation.');}
  };
  void loadEvidence();void loadQueue();return()=>c.abort();
 },[location.lat,location.lon,prepared,retry]);
 async function save(planId:string){
  const key=locationKey;setBusy(planId);setError('');
  try{
   const r=await fetch('/api/operations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'create-plan-task',planId,location}),signal:AbortSignal.timeout(30000)});
   const data=await r.json();if(!r.ok)throw Error(data.error||'Could not save inspection.');
   if(currentLocation.current===key)setSaved(p=>[...new Set([...p,planId])]);
  }catch(e){if(currentLocation.current===key)setError(e instanceof Error&&e.name==='TimeoutError'?'Task confirmation timed out. Retry to check the queue before creating again.':e instanceof Error?e.message:'Could not save inspection.');}
  finally{if(currentLocation.current===key)setBusy(null);}
 }
 const plan=assessment?buildPreventionPlan(assessment):[];
 return <section className="prevention-plan"><p className="small-source">{location.name} · Evidence-linked work proposals</p>{assessment&&<><OpportunityScore opportunity={assessmentOpportunity(assessment)}/><p className="small-source">Local assessment · {assessment.location.radiusM/1000} km geographic inventory. This can differ from the wider watch-area score.</p></>}{(error||queueError)&&<div role="alert">{error&&<p>{error}</p>}{queueError&&<p>{queueError}</p>}<button className="secondary-button" disabled={busy!==null} onClick={()=>setRetry(n=>n+1)}>Retry evidence and tasks</button></div>}{!assessment&&!error&&<p role="status">Building the plan from current evidence…</p>}{(['prevention','assets','coordination'] as const).map(category=><section key={category}><h3>{category==='prevention'?'Prevention':category==='assets'?'Asset checks':'Coordination'}</h3>{plan.filter(p=>p.category===category).map(p=><article className="plan-card" key={p.id}><div className="feed-entry-top"><h4>{p.title}</h4><span className="badge watch">{p.priority}</span></div><p>{p.reason}</p><details><summary>Inspection checklist</summary><ul>{p.checks.map(c=><li key={c}>{c}</li>)}</ul><small>Evidence: {new Date(p.evidenceAt).toLocaleString()}<br/>{p.sourceNames.join(' · ')||'Source gaps recorded'}</small></details><button className="secondary-button" disabled={!queueReady||busy!==null||saved.includes(p.id)} onClick={()=>void save(p.id)}>{saved.includes(p.id)?'In task queue':busy===p.id?'Saving…':!queueReady?'Checking task queue…':'Create inspection'}</button></article>)}</section>)}<WildfireReferences/><div className="prevention-card-actions"><button className="primary-button" onClick={onTasks}>Open task queue ↗</button><button className="secondary-button" onClick={onCompare}>Explore mitigation scenarios ↗</button></div><p className="small-source">Proposals use explicit review rules. Field checks and scenario assumptions remain subject to verification.</p></section>;
}
