'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import type {RunState} from '@/lib/sage/types';
import type {ForecastExposure} from '@/lib/product-contracts';
import {exposureAtMinute} from '@/lib/sage/forecast-exposure-summary';

/** Saved consequences stay separate from Prevent's current environmental assessment. */
export default function ReturnedForecast({run,minute}:{run:RunState;minute:number}){
 const [exposure,setExposure]=useState<ForecastExposure|null>(null),[error,setError]=useState('');
 useEffect(()=>{const controller=new AbortController();setExposure(null);setError('');
  void fetch(`/api/sage/runs/${encodeURIComponent(run.id)}/exposure`,{signal:controller.signal}).then(async response=>{if(!response.ok)throw Error('Saved exposure unavailable');return response.json();}).then(value=>{if(!controller.signal.aborted)setExposure(value);}).catch(()=>{if(!controller.signal.aborted)setError('Saved exposure unavailable.');});return()=>controller.abort();
 },[run.id]);
 const result=run.result;if(!result)return null;
 const at=Math.max(0,Math.min(result.request.horizonMinutes,Number.isFinite(minute)?Math.floor(minute):0));
 const summary=exposure?exposureAtMinute(exposure,at):null;
 const buildings=result.buildings.filter(building=>building.arrivalByMember[0]!==null&&building.arrivalByMember[0]<=at).length;
 const query=new URLSearchParams({sageRun:run.id,minute:String(at),...(result.scenario?{scenario:result.scenario.id}:{})});
 return <section className="prevent-returned-forecast" aria-label="Saved Sage forecast">
  <p className="r-eyebrow">SAGE · SAVED {result.request.mode==='confirmed'?'INCIDENT FORECAST':'HYPOTHETICAL SCENARIO'}</p>
  <h3>{summary?.counts?`${summary.central.length} mapped ${summary.central.length===1?'asset':'assets'} reached at +${at} min`:error||(!exposure?'Loading saved consequences…':'Exposure cannot be assessed')}</h3>
  <p>{Date.now()-Date.parse(result.forecastOrigin)>result.request.horizonMinutes*60000?'Historical model output':'Modelled exposure'} · {exposure?.status||'coverage pending'}</p>
  <Link href={`/sage?${query}`}>Resume forecast ↗</Link>
  <details><summary>Basis & coverage</summary>
   <p>Central projection from {new Date(result.forecastOrigin).toLocaleString('en-GB',{timeZone:'Europe/Madrid',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})} Madrid. Run {run.id}.</p>
   <p>{buildings} building footprints reached. Facilities may contain these buildings; counts are not additive.</p>
   <p>Saved model output, separate from current conditions above. Exposure is not confirmed damage.</p>
  </details>
 </section>;
}
