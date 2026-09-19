'use client';
import {wildfireReferences} from '@/lib/wildfire-references';
import {useEffect,useState} from 'react';
import type {DeepfireContext} from '@/lib/providers/deepfire-context';
export default function IntegrationSources({deepfire,weatherNext}:{deepfire?:DeepfireContext;weatherNext?:string}){
 const [config,setConfig]=useState<Record<string,boolean>|null>(null),[failed,setFailed]=useState(false);
 useEffect(()=>{const c=new AbortController();fetch('/api/integrations',{signal:c.signal}).then(async r=>{if(!r.ok)throw Error();setConfig(await r.json());}).catch(()=>{if(!c.signal.aborted)setFailed(true);});return()=>c.abort();},[]);
 const configured=(key:string)=>failed?'Status unavailable':config?config[key]?'Configured · validation required':'Setup needed':'Checking';
 const rows=[
  ...wildfireReferences.map(s=>({name:s.name,status:s.status,detail:`${s.scope} · ${s.kind}. ${s.detail}`,url:s.url})),
  {name:'Deepfire',status:configured('deepfire'),detail:'Multi-satellite hotspots, candidate clusters, estimated perimeters and persistent heat sources. Used in prevention maps, inspection evidence and Sage.',url:'https://app.deepfire.co/settings/api-clients'},
  {name:'Sage AI',status:configured('sage'),detail:'Interprets current evidence for prevention and inspection. Requires the server-side OPENAI_API_KEY.',url:'https://platform.openai.com/api-keys'},
  {name:'MTG / LSA SAF',status:configured('mtg'),detail:'MTG detections can arrive through Deepfire. The native ten-minute NetCDF product needs LSASAF access and decoding; a separate normalized-file adapter is available.',url:'https://datalsasaf.lsasvcs.ipma.pt/PRODUCTS/MTG/MTFRPPixel/'},
  {name:'Google WeatherNext',status:weatherNext||configured('weatherNext'),detail:'Point-export adapter available. Requires Google model access and a normalized export; Open-Meteo supplies the current forecast.',url:'https://deepmind.google/science/weathernext/'},
  {name:'Pyro-SDIS',status:'Training dataset',detail:'Camera smoke-detection training data. A trained detector and live camera connection are still required.',url:'https://huggingface.co/datasets/pyronear/pyro-sdis'},
  {name:'ELMFIRE',status:configured('elmfire'),detail:'Imported-result adapter available. A solver, terrain, fuel and weather inputs are required for ELMFIRE runs. Ginger’s scenario engine is separate.',url:'https://elmfire.io/'},
  {name:'Catalonia / Bombers',status:'Planning reference · v2014',detail:'77 official fire-regime zones imported. Inspections and Sage receive the zone containing the selected point. Historical planning context, not current fire danger.',url:'https://interior.gencat.cat/ca/serveis/informacio-geografica/'},
 ];
 return <section aria-label="Source integrations"><h3>Sources & tools</h3>{rows.map(r=><details className="provider-row" key={r.name}><summary>{r.name} · {r.status}</summary><p>{r.detail}</p><a href={r.url} target="_blank" rel="noreferrer">Open {r.name} ↗</a>{r.name==='Deepfire'&&deepfire?.sources.map(s=><p key={s.source}>{s.source} · {s.status}<br/><small>{s.detail}</small></p>)}</details>)}</section>;
}
