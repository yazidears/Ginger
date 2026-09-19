'use client';
import {useEffect,useRef,useState} from 'react';
import type {MonitorChange,MonitorSnapshot} from '@/lib/monitor';
const storageKey='ginger:acknowledged-changes:v1';
export default function useMonitorAlerts(monitor:MonitorSnapshot|null){
 const [acknowledged,setAcknowledged]=useState<string[]>([]);
 const [announcement,setAnnouncement]=useState<MonitorChange[]>([]);
 const seen=useRef<Set<string>|null>(null);
 useEffect(()=>{try{const saved=JSON.parse(localStorage.getItem(storageKey)||'[]');if(Array.isArray(saved))setAcknowledged(saved.filter((id):id is string=>typeof id==='string'));}catch{/* Storage is optional. */}},[]);
 useEffect(()=>{
  if(!monitor)return;
  const ids=new Set(monitor.deltas.map(change=>change.id));
  if(seen.current){const fresh=monitor.deltas.filter(change=>!seen.current!.has(change.id));if(fresh.length)setAnnouncement(previous=>[...fresh,...previous].filter(change=>ids.has(change.id)).slice(0,50));}
  seen.current=ids;
 },[monitor]);
 const acknowledge=(id:string)=>{setAcknowledged(previous=>{const next=[...previous.filter(value=>value!==id),id].slice(-500);try{localStorage.setItem(storageKey,JSON.stringify(next));}catch{/* Keep acknowledgments in memory if storage is unavailable. */}return next;});setAnnouncement(previous=>previous.filter(change=>change.id!==id));};
 return {acknowledged,acknowledge,announcement,dismiss:()=>setAnnouncement([])};
}
