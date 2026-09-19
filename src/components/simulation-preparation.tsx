'use client';
import {useEffect,useState} from 'react';
import {ScanLine,Pause,Play} from 'lucide-react';
import './simulation-preparation.css';
export default function SimulationPreparation({stage,footprints,location,error}:{stage:string;footprints:number;location:{lat:number;lon:number};error:string}){
 const [seconds,setSeconds]=useState(0),[paused,setPaused]=useState(false);
 useEffect(()=>{const started=Date.now();const timer=setInterval(()=>setSeconds(Math.floor((Date.now()-started)/1000)),1000);return()=>clearInterval(timer);},[]);
 return <div className={'simulation-preparation '+(paused?'motion-paused':'')} aria-label="Preparing simulation"><div className="mapping-grid" aria-hidden="true"/><div className="mapping-sweep" aria-hidden="true"/><div className="mapping-target" aria-hidden="true"><i/><i/><i/></div><div className="mapping-caption"><span>SELECTED ORIGIN</span><b>{location.lat.toFixed(5)}°, {location.lon.toFixed(5)}°</b></div><section className="mapping-status"><div className="mapping-heading"><ScanLine size={20}/><span>Preparing your simulation</span><button type="button" aria-label={paused?'Resume mapping animation':'Pause mapping animation'} onClick={()=>setPaused(v=>!v)}>{paused?<Play size={16}/>:<Pause size={16}/>}</button></div><h2 role="status">{stage}</h2><p>{footprints?`${footprints} mapped building footprints loaded`:'Reading the selected landscape'}</p><div className="mapping-activity" aria-hidden="true"><i/></div><footer><span>Model running in the background</span><span>{seconds}s</span></footer><small>The spread animation appears when the result is ready.</small>{error&&<p role="alert">{error} · Reconnecting to this run…</p>}</section></div>;
}
