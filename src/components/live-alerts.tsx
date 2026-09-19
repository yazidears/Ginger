'use client';
import WildfireReferences from './wildfire-references';
import {useEffect,useState} from 'react';
import ChangeAlerts from './change-alerts';
import {EvidenceBadge} from './evidence';
import {ArrowUpRight,Bell,Clock3,Radio,TriangleAlert} from 'lucide-react';
import type {MonitorSnapshot,MonitorZone} from '@/lib/monitor';
const stamp=(value:string)=>new Date(value).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'})+' UTC';
function Countdown({zone,now}:{zone:MonitorZone;now:number}){
 const window=zone.hazardWindow;
 if(!window)return <div className="alert-timing"><Clock3 size={14}/><span>Fire arrival ETA <b>Unavailable</b></span></div>;
 const seconds=Math.max(0,Math.ceil((Date.parse(window.startsAt)-now)/1000));
 const elapsed=now>=Date.parse(window.endsAt);
 const stale=now-Date.parse(zone.updatedAt)>20*60000;
 return <div className="alert-countdown" data-evidence="simulated"><EvidenceBadge kind="simulated"/><div><span>HAZARDOUS WEATHER WINDOW</span><b>{!now?'Updating…':stale?'Awaiting refresh':elapsed?'Window elapsed':seconds===0?'In progress':`${String(Math.floor(seconds/3600)).padStart(2,'0')}:${String(Math.floor(seconds%3600/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`}</b></div><p>{stamp(window.startsAt)}–{stamp(window.endsAt)} · hourly forecast</p><small>Weather threshold timing · fire arrival ETA unavailable</small></div>;
}
export default function LiveAlerts({monitor,error,onInspect,onSources,acknowledged,onAcknowledge}:{acknowledged:string[];onAcknowledge:(id:string)=>void;monitor:MonitorSnapshot|null;error:string;onInspect:(zone:MonitorZone)=>void;onSources:()=>void}){
 const [now,setNow]=useState(0),[filter,setFilter]=useState<'alerts'|'sectors'>('alerts');
 useEffect(()=>{setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
 const zones=monitor?.zones||[];
 const rank={escalating:0,review:1,unavailable:2,monitoring:3};
 const signals=zones.filter(z=>z.state==='escalating'||(z.hotspots??0)>0||z.hazardWindow);
 const visible=[...(filter==='alerts'?signals:zones)].sort((a,b)=>rank[a.state]-rank[b.state]);
 const gaps=zones.filter(z=>z.state==='unavailable'||z.temperature===null||z.hotspots===null).length;
 const stale=!!monitor?.lastScan&&now-Date.parse(monitor.lastScan)>20*60000;
 return <aside className="live-alerts panel" aria-label="Live alerts feed"><div className="live-feed-heading"><div><h2>Needs attention <span>{signals.length}</span></h2></div><Bell size={20}/></div><div className="live-feed-tabs"><button aria-pressed={filter==='alerts'} onClick={()=>setFilter('alerts')}>Alerts</button><button aria-pressed={filter==='sectors'} onClick={()=>setFilter('sectors')}>Sectors <span>{zones.length}</span></button></div><div className="live-feed-scroll"><div role="status" className="live-feed-status"><i className="status-dot"/>{!monitor?'Connecting…':stale?'Regional scan is stale':`Updated ${monitor.lastScan?stamp(monitor.lastScan):'—'}`}</div>{error&&<p className="live-source-gap" role="alert">{error}</p>}{(gaps>0||stale)&&<button className="live-source-gap" onClick={onSources}><TriangleAlert size={15}/><span>{stale?'Monitoring needs a fresh scan':`${gaps} sectors have incomplete coverage`}<small>Check sources ↗</small></span></button>}<WildfireReferences context="incidents"/><ChangeAlerts monitor={monitor} onInspect={onInspect} acknowledged={acknowledged} onAcknowledge={onAcknowledge}/>{!monitor?<div className="live-quiet"><Radio size={25}/><h3>Listening for changes</h3><p>Checking weather and satellite data.</p></div>:visible.length===0?<div className="live-quiet"><Radio size={25}/><h3>No active alerts</h3><p>{gaps?'Coverage is incomplete.':'Monitoring continues.'}</p><small>This is not an all-clear.</small></div>:visible.map(z=><article className={'live-alert '+(z.state==='escalating'?'urgent':'')} key={z.id}><div className="live-alert-meta"><span className={'badge '+(z.state==='escalating'?'critical':z.state==='monitoring'?'watch':'high')}>{z.state==='escalating'?'Urgent review':z.hazardWindow?'Weather watch':(z.hotspots??0)>0?'Thermal detection':z.state}</span><time>{stamp(z.updatedAt)}</time></div><h3>{z.name}</h3><p>{z.hotspots?`${z.hotspots} thermal detections · verify on site`:z.hazardWindow?"Hot, dry and windy weather forecast":z.reasons[0]}</p><details className="signal-evidence"><summary>Evidence & timing</summary><EvidenceBadge kind="derived" detail="Review rules"/><p>{z.reasons[0]}</p><Countdown zone={z} now={now}/></details><button className="live-inspect" onClick={()=>onInspect(z)}>Inspect <ArrowUpRight size={15}/></button></article>)}</div></aside>;
}
