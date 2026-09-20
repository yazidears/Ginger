'use client';
import {assessmentOpportunity} from '@/lib/prevention-opportunity';
import {OpportunityScore} from './prevention-opportunities';
import WildfireReferences from './wildfire-references';
import {useEffect,useState} from 'react';
import type {Assessment} from '@/lib/assessment';
import type {PreparedArea} from '@/lib/prepared-workspace';
import {buildPreventionPlan} from '@/lib/prevention-plan';
export default function PreventionPlan({location,onCompare,prepared}:{prepared?:PreparedArea|null;location:{name:string;lat:number;lon:number};onCompare:()=>void}){
 const [assessment,setAssessment]=useState<Assessment|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{
  const c=new AbortController();setAssessment(null);setError('');
  const signal=()=>AbortSignal.any([c.signal,AbortSignal.timeout(22000)]);
  const loadEvidence=async()=>{
   try{
    let a:Assessment;
    if(prepared)a=prepared.assessment;
    else{const r=await fetch(`/api/assessment?lat=${location.lat}&lon=${location.lon}`,{signal:signal()});if(!r.ok)throw Error('Could not load current evidence.');a=await r.json();}
    if(!c.signal.aborted)setAssessment(a);
   }catch(e){if(!c.signal.aborted)setError(e instanceof Error&&e.name==='TimeoutError'?'Evidence request timed out.':e instanceof Error?e.message:'Could not load current evidence.');}
  };
  void loadEvidence();return()=>c.abort();
 },[location.lat,location.lon,prepared,retry]);
 const plan=assessment?buildPreventionPlan(assessment):[];
 return <section className="prevention-plan"><p className="small-source">{location.name} · Evidence-linked work proposals</p>{assessment&&<><OpportunityScore opportunity={assessmentOpportunity(assessment)}/><p className="small-source">Local assessment · {assessment.location.radiusM/1000} km geographic inventory. This can differ from the wider watch-area score.</p></>}{error&&<div role="alert"><p>{error}</p><button className="secondary-button" onClick={()=>setRetry(n=>n+1)}>Retry evidence</button></div>}{!assessment&&!error&&<p role="status">Building the plan from current evidence…</p>}{(['prevention','assets','coordination'] as const).map(category=><section key={category}><h3>{category==='prevention'?'Prevention':category==='assets'?'Asset checks':'Coordination'}</h3>{plan.filter(p=>p.category===category).map(p=><article className="plan-card" key={p.id}><div className="feed-entry-top"><h4>{p.title}</h4><span className="badge watch">{p.priority}</span></div><p>{p.reason}</p><details><summary>Inspection checklist</summary><ul>{p.checks.map(c=><li key={c}>{c}</li>)}</ul><small>Evidence: {new Date(p.evidenceAt).toLocaleString()}<br/>{p.sourceNames.join(' · ')||'Source gaps recorded'}</small></details></article>)}</section>)}<WildfireReferences/><div className="prevention-card-actions"><button className="secondary-button" onClick={onCompare}>Explore mitigation scenarios ↗</button></div><p className="small-source">Proposals use explicit review rules. Field checks and scenario assumptions remain subject to verification.</p></section>;
}
