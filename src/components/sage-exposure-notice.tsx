'use client';
import {useState} from 'react';
import type {ForecastExposure} from '@/lib/product-contracts';
import {exposureNotice} from '@/lib/sage/exposure-notice';
import './sage-exposure-notice.css';
export default function SageExposureNotice({exposure,minute,onInspect}:{exposure:ForecastExposure|null;minute:number;onInspect:(id:string)=>void}){
  const [dismissed,setDismissed]=useState<string[]>([]);const notice=exposureNotice(exposure,minute);
  if(!notice||dismissed.includes(notice.key))return null;
  const rawName=notice.asset.name;const name=rawName==='residential'?'Mapped residential area':rawName;
  return <aside className="sage-exposure-notice" aria-label="Modelled exposure notice"><div><small>{notice.reached?'MODELLED ARRIVAL':'UPCOMING EXPOSURE'} · +{Math.ceil(notice.arrival)}m</small><p>{name} {notice.reached?'is reached in the central projection':`could be reached in ${notice.remaining} model minute${notice.remaining===1?'':'s'}`}.</p><span>Modelled exposure{notice.asset.category==='road'?', not a road closure':', not confirmed damage'}{exposure?.status==='partial'||notice.asset.coverage==='partial'?' · Partial coverage':''}{exposure?.status==='stale'?' · Older inventory':''}.</span><button onClick={()=>onInspect(notice.asset.id)}>Inspect on map ↗</button></div><button className="sage-exposure-dismiss" aria-label="Dismiss this exposure notice" onClick={()=>setDismissed(values=>[...values.slice(-49),notice.key])}>×</button></aside>;
}
