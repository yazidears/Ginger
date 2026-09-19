'use client';
import {useState} from 'react';
export type EvidenceKind='observed'|'derived'|'simulated';
export const evidence={
 observed:{label:'Observed',symbol:'●',description:'Direct external records',detail:'Satellite detections, mapped footprints and reported measurements. Source age and coverage still matter.'},
 derived:{label:'Derived',symbol:'◆',description:'Calculated from evidence',detail:'Counts, comparisons, review rules and geometry calculations. These are interpretations of inputs, not new observations.'},
 simulated:{label:'Simulated',symbol:'△',description:'Hypothetical & modelled',detail:'Weather forecasts, fire spread, exposure estimates and demo scenarios. Real inputs do not make a projected outcome observed.'},
} as const;
export function EvidenceBadge({kind,detail}:{kind:EvidenceKind;detail?:string}){return <span className="evidence-badge" data-evidence={kind} title={detail||evidence[kind].detail}><span aria-hidden="true">{evidence[kind].symbol}</span>{evidence[kind].label}{detail&&<span className="evidence-badge-detail"> · {detail}</span>}</span>;}
export function EvidenceKey({demo=false}:{demo?:boolean}){const [open,setOpen]=useState<EvidenceKind|null>(null);return <section className="evidence-key" aria-label="Information provenance"><div className="evidence-key-cards">{(Object.keys(evidence) as EvidenceKind[]).map(kind=><button key={kind} data-evidence={kind} aria-expanded={open===kind} onClick={()=>setOpen(open===kind?null:kind)}><EvidenceBadge kind={kind}/><span>{evidence[kind].description}</span><small>{open===kind?'−':'+'}</small></button>)}</div>{open&&<p className="evidence-explanation" data-evidence={open}>{evidence[open].detail}</p>}{demo&&<p className="evidence-demo-note">△ Simulation workspace · all incident values, camera imagery, alerts and recommendations are hypothetical.</p>}</section>;}
