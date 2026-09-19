'use client';
import ExposureSummaryView from './exposure-summary';
import WildfireReferences from './wildfire-references';
import {useState} from 'react';
import type {MonitorSnapshot} from '@/lib/monitor';
import type {DetectionSnapshot} from '@/lib/detections';
import SageConversation from './sage-conversation';
const stamp=(s:string|null|undefined)=>s?new Date(s).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'UTC'})+' UTC':'Awaiting data';
export default function PreventionPanel({view,monitor,detections,error,region,onRegion,onInspect,onSources,onPlan}:{view:'prevention'|'detections';monitor:MonitorSnapshot|null;detections:DetectionSnapshot|null;error:string;region:'catalonia'|'iberia'|'europe';onRegion:(r:'catalonia'|'iberia'|'europe')=>void;onInspect:(lon:number,lat:number,name?:string)=>void;onSources:()=>void;onPlan:(lon:number,lat:number,name:string)=>void}){
 const [sageArea,setSageArea]=useState<string|null>(null);
 const rank={escalating:0,review:1,unavailable:2,monitoring:3};
 const zones=[...(monitor?.zones||[])].sort((a,b)=>rank[a.state]-rank[b.state]||(b.exposure?.uplift??0)-(a.exposure?.uplift??0));
 const source=detections?.source||'Satellite';
 return <aside className="prevention-panel panel" aria-label={view==='prevention'?'Prevention priorities':'Live satellite detections'}>
  <header><span className="eyebrow">{view==='prevention'?'PREVENTION':source}</span><h2>{view==='prevention'?'Areas to watch':'Satellite detections'}</h2><p>{view==='prevention'?'Weather, heat signals and next checks.':'Past 24 hours · unconfirmed heat signals.'}</p></header>
  <div className="prevention-scroll"><WildfireReferences context={view==='prevention'?'all':'incidents'}/>
   {error&&<p className="live-source-gap" role="alert">{error}</p>}
   <button className="prevention-health" onClick={onSources}>View sources · {error?'check connection':detections?.status||'connecting'} ↗<small>{source} · {stamp(detections?.retrievedAt)}</small></button>
   {view==='prevention'?<>
    {!monitor&&<p role="status">Checking watch areas…</p>}
    {monitor&&!zones.length&&<p>Add a watch area in Areas to start monitoring.</p>}
    {zones.map(z=><article key={z.id} className="prevention-area">
     <div className="feed-entry-top"><h3>{z.name}</h3><span className={'badge '+(z.state==='escalating'?'critical':z.state==='monitoring'?'watch':'high')}>{z.state==='monitoring'?'Monitoring':z.state==='unavailable'?'Data gap':z.state==='escalating'?'Priority':'Review'}</span></div>
     <p>{z.temperature??'—'}°C · {z.humidity??'—'}% RH · {z.windKmh??'—'} km/h</p>
     <p>{z.hotspots===null?'Satellite data unavailable':`${z.hotspots} heat signals · ${(z.radiusM??15000)/1000} km · 6h`}</p>
     {(z.hazardWindow||z.hotspots||z.temperature===null||z.hotspots===null)?<p className="prevention-action">{z.hotspots?'Verify heat signals.':z.hazardWindow?`Weather review from ${stamp(z.hazardWindow.startsAt)}.`:'Check missing sources.'}</p>:null}
     <ExposureSummaryView exposure={z.exposure} compact/><div className="prevention-card-actions"><button className="secondary-button" onClick={()=>onPlan(z.position[0],z.position[1],z.name)}>Plan ↗</button><button className="secondary-button" onClick={()=>onInspect(z.position[0],z.position[1],z.name)}>Inspect ↗</button><button className="secondary-button" aria-expanded={sageArea===z.id} onClick={()=>setSageArea(sageArea===z.id?null:z.id)}>Ask Sage</button></div>
     {sageArea===z.id&&<SageConversation key={z.id} lat={z.position[1]} lon={z.position[0]} context="prevention"/>}
    </article>)}
    <details className="signal-evidence"><summary>How priorities work</summary><p>Weather review: ≥28°C, ≤25% humidity and ≥25 km/h wind together. Heat signals need verification. Within the same review state, nearby schools, healthcare, complexes, roads and gathering places raise priority by up to 40 points when a weather or heat trigger is present. This is an uncalibrated exposure rule; it does not increase the chance of ignition. No trigger is not an all-clear.</p><p>Map rings mark watch areas. Dashed orange polygons are satellite-estimated perimeters, not confirmed boundaries. Weather checked {stamp(monitor?.lastScan)}.</p></details>
   </>:<>
    <label className="prevention-region">Region<select value={region} onChange={e=>onRegion(e.target.value as typeof region)}><option value="catalonia">Catalonia</option><option value="iberia">Iberia</option><option value="europe">Europe</option></select></label>
    <p role="status">{detections?`${detections.hotspots.length} detections`:'Connecting…'}</p>
    {detections?.hotspots.length===0&&<p>No recent detections returned. Try a wider region; fire may still be present.</p>}
    {detections?.hotspots.map(h=><button className="prevention-detection" key={h.id} onClick={()=>onInspect(h.position[0],h.position[1],'Satellite detection')}><strong>{h.position[1].toFixed(3)}°, {h.position[0].toFixed(3)}° ↗</strong><span>{stamp(h.provenance.observedAt)}</span><small>{h.frpMw??'Unknown'} MW · {h.confidence} · {h.provenance.source}</small></button>)}
   </>}
  </div>
 </aside>;
}
