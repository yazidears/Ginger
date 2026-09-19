'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Download,Upload,Play,Pause,RotateCcw,FlaskConical,Layers,Check,Wind} from 'lucide-react';
import type {ReplayFrame,ReplayJob,ReplayReport,Score} from '@/lib/replay/types';
import MapLayers from './shared-map';
import type {FeatureCollection} from 'geojson';
import {toLonLat, toLocal} from '@/lib/sage/geometry';
import './replay-workspace.css';

const pct=(v:number|null)=>v===null?'—':`${(v*100).toFixed(1)}%`;
const num=(v:number|null,d=1)=>v===null?'—':v.toFixed(d);
const time=(s:string)=>new Date(s).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'});
type SavedJob=Omit<ReplayJob,'result'>&{kind?:ReplayReport['kind']};
type MapMode='difference'|'agreement';
const colors={hit:'#507f72',miss:'#d86647',extra:'#d3ad56',observed:'#b09ce8'};

function ReplayMap({report,frame,updated,mode}:{report:ReplayReport;frame:ReplayFrame;updated:boolean;mode:MapMode}){
  const canvas=useRef<HTMLCanvasElement>(null),[hover,setHover]=useState<number|null>(null);
  const probabilities=updated?frame.updatedProbability:frame.baselineProbability;
  useEffect(()=>{
    const node=canvas.current;if(!node)return;
    const ctx=node.getContext('2d');if(!ctx)return;
    const n=report.size,width=960,step=width/n;node.width=width;node.height=width;
    const minimum=Math.min(...report.elevations),maximum=Math.max(...report.elevations);
    ctx.clearRect(0,0,width,width);
    for(let i=0;i<n*n;i++){
      const x=i%n,y=n-1-Math.floor(i/n),e=(report.elevations[i]-minimum)/(maximum-minimum||1);
      const light=80-e*24;ctx.fillStyle=`hsl(75 13% ${light}%)`;ctx.fillRect(x*step,y*step,step+.4,step+.4);
      if(i%n<n-1&&Math.floor(report.elevations[i]/5)!==Math.floor(report.elevations[i+1]/5)){
        ctx.strokeStyle='rgba(70,83,49,.17)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo((x+1)*step,y*step);ctx.lineTo((x+1)*step,(y+1)*step);ctx.stroke();
      }
      const p=probabilities[i],observed=!!frame.observed[i],hit=p>=.5;
      if(mode==='difference'){
        if(observed||hit){ctx.globalAlpha=.83;ctx.fillStyle=hit&&observed?colors.hit:observed?colors.miss:colors.extra;ctx.fillRect(x*step,y*step,step+.3,step+.3);ctx.globalAlpha=1;}
      }else if(p>0){ctx.fillStyle=`rgba(82,59,146,${.12+.82*p})`;ctx.fillRect(x*step,y*step,step+.3,step+.3);}
    }
    // Light coordinate grid in local metres, not an invented road network.
    ctx.strokeStyle='rgba(32,48,36,.12)';ctx.lineWidth=1;
    for(let t=0;t<=width;t+=width/6){ctx.beginPath();ctx.moveTo(t,0);ctx.lineTo(t,width);ctx.moveTo(0,t);ctx.lineTo(width,t);ctx.stroke();}
    for(const ring of frame.observationGeometry.coordinates){
      ctx.beginPath();ring.forEach((p,i)=>{const [x,y]=toLocal(p,report.center),px=(x/(n*report.cellM)+.5)*width,py=(.5-y/(n*report.cellM))*width;if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);});
      ctx.closePath();ctx.strokeStyle='#fcf9ff';ctx.lineWidth=6;ctx.stroke();ctx.strokeStyle='#68508b';ctx.lineWidth=2;ctx.stroke();
    }
    if(hover!==null){const x=hover%n,y=n-1-Math.floor(hover/n);ctx.strokeStyle='#15291f';ctx.lineWidth=3;ctx.strokeRect(x*step,y*step,step,step);}
  },[report,frame,probabilities,mode,hover]);
  return <div className="replay-map-wrap"><canvas ref={canvas} role="img" tabIndex={0}
    aria-label={`${updated?'Updated':'Frozen'} forecast at ${frame.minute} minutes. ${pct((updated?frame.updated:frame.baseline).iou)} overlap with reference perimeter. Arrow keys inspect cells.`}
    onKeyDown={e=>{const delta:Record<string,number>={ArrowRight:1,ArrowLeft:-1,ArrowUp:report.size,ArrowDown:-report.size};if(delta[e.key]){e.preventDefault();setHover(i=>Math.max(0,Math.min(report.size**2-1,(i??Math.floor(report.size**2/2))+delta[e.key])));}}}
    onPointerMove={e=>{const r=e.currentTarget.getBoundingClientRect(),x=Math.min(report.size-1,Math.floor((e.clientX-r.left)/r.width*report.size)),y=Math.min(report.size-1,Math.floor((e.clientY-r.top)/r.height*report.size));setHover((report.size-1-y)*report.size+x);}}
    onPointerLeave={()=>setHover(null)}/>
    <span className="replay-north">N ↑</span><span className="replay-scale"><i/>{report.cellM*report.size/4} m</span>
    <span className="replay-map-note">{report.kind==='synthetic'?'Constructed terrain':'Imported terrain'} · {report.cellM} m cells</span>
    {hover!==null&&<div className="replay-cell" aria-live="polite">Member agreement <b>{pct(probabilities[hover])}</b><span>Reference: {frame.observed[hover]?'burned':'not burned'}</span></div>}
  </div>;
}

function SkillChart({report,index,onSelect}:{report:ReplayReport;index:number;onSelect:(i:number)=>void}){
  const x=(i:number)=>32+i*540/(report.frames.length-1),y=(v:number|null)=>112-(v??0)*86;
  return <div className="replay-chart"><div><h3>Does the forecast improve?</h3><p>Perimeter overlap · higher is better</p><div className="replay-chart-legend"><span><i/>Frozen</span><span><i/>Updated</span></div></div>
    <svg viewBox="0 0 610 145" role="img" aria-label="Perimeter overlap at each replay time, comparing frozen and updated forecasts">
      {[0,.5,1].map(v=><g key={v}><path d={`M32 ${y(v)}H572`} stroke="#d9ded5" strokeDasharray="3 4"/><text x="0" y={y(v)+4} fontSize="10" fill="#667166">{v*100}%</text></g>)}
      <path d={report.frames.map((f,i)=>`${i?'L':'M'}${x(i)} ${y(f.baseline.iou)}`).join(' ')} fill="none" stroke="#9d947d" strokeWidth="2" strokeDasharray="5 4"/>
      <path d={report.frames.map((f,i)=>`${i?'L':'M'}${x(i)} ${y(f.updated.iou)}`).join(' ')} fill="none" stroke="#245c47" strokeWidth="3"/>
      <path d={`M${x(index)} 18V117`} stroke="#245c47" opacity=".3"/>
      {report.frames.map((f,i)=><g key={f.at}><circle cx={x(i)} cy={y(f.updated.iou)} r={i===index?5:3} fill="#245c47"/><text x={x(i)} y="137" textAnchor="middle" fontSize="10" fill="#667166">+{f.minute}m</text></g>)}
    </svg><div className="replay-chart-times">{report.frames.map((f,i)=><button key={f.at} aria-label={`Inspect ${f.minute} minutes`} aria-pressed={i===index} onClick={()=>onSelect(i)}>+{f.minute}m</button>)}</div>
  </div>;
}

function MetricTable({frame}:{frame:ReplayFrame}){
  const rows:{name:string;key:keyof Score;format:(v:number|null)=>string;direction:string}[]=[
    {name:'Perimeter overlap',key:'iou',format:pct,direction:'Higher is better'},
    {name:'Missed burned area',key:'missedHa',format:v=>`${num(v)} ha`,direction:'Lower is better'},
    {name:'Excess predicted area',key:'extraHa',format:v=>`${num(v)} ha`,direction:'Lower is better'},
    {name:'Mean boundary distance',key:'boundaryMeanM',format:v=>`${num(v,0)} m`,direction:'Lower is better'},
    {name:'95th percentile boundary distance',key:'boundaryP95M',format:v=>`${num(v,0)} m`,direction:'Lower is better'},
    {name:'Brier score',key:'brier',format:v=>num(v,4),direction:'Lower is better'},
    {name:'Balanced Brier score',key:'balancedBrier',format:v=>num(v,4),direction:'Lower is better'},
  ];
  return <div className="replay-table-wrap"><table className="replay-metrics"><thead><tr><th>Measure</th><th>Frozen</th><th>Updated</th></tr></thead><tbody>{rows.map(r=>{
    const before=frame.baseline[r.key] as number|null,after=frame.updated[r.key] as number|null;
    const gain=before===null||after===null?0:(after-before)*(r.key==='iou'?1:-1);
    return <tr key={r.key}><th>{r.name}<small>{r.direction}</small></th><td>{r.format(before)}</td><td className={gain>1e-10?'replay-better':gain< -1e-10?'replay-worse':''}>{r.format(after)}<span className="replay-direction" aria-label={gain>1e-10?'improved':gain< -1e-10?'worsened':'unchanged'}>{gain>1e-10?'↗':gain< -1e-10?'↘':'='}</span></td></tr>;
  })}</tbody></table></div>;
}

export default function ReplayWorkspace(){
  const [job,setJob]=useState<ReplayJob|null>(null),[jobs,setJobs]=useState<SavedJob[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [showSynthetic,setShowSynthetic]=useState(false);
  const visibleJobs=jobs.filter(j=>showSynthetic||j.kind!=='synthetic');
  const [index,setIndex]=useState(0),[playing,setPlaying]=useState(false),[mode,setMode]=useState<MapMode>('difference'),[tab,setTab]=useState<'evaluation'|'members'|'method'>('evaluation');
  const upload=useRef<HTMLInputElement>(null),requestSequence=useRef(0);
  const report=job?.result,frame=report?.frames[index]??report?.frames[0];
  const [forecast,setForecast]=useState<'updated'|'baseline'>('updated');
  const [mapFocus,setMapFocus]=useState(0);
  const replayLayers=useMemo<FeatureCollection>(()=>{
    if(!report||!frame)return {type:'FeatureCollection',features:[]};
    const probabilities=forecast==='updated'?frame.updatedProbability:frame.baselineProbability;
    const features:FeatureCollection['features']=[];
    for(let i=0;i<probabilities.length;i++){
      const p=probabilities[i], observed=Boolean(frame.observed[i]), hit=p>=.5;
      if(mode==='difference'?!(observed||hit):p<=0)continue;
      const x=(i%report.size-report.size/2)*report.cellM,y=(Math.floor(i/report.size)-report.size/2)*report.cellM;
      features.push({type:'Feature',properties:{color:mode==='difference'?(hit&&observed?colors.hit:observed?colors.miss:colors.extra):`hsl(260, 45%, ${85-p*55}%)`},geometry:{type:'Polygon',coordinates:[[[x,y],[x+report.cellM,y],[x+report.cellM,y+report.cellM],[x,y+report.cellM],[x,y]].map(point=>toLonLat(point as [number,number],report.center))]}});
    }
    features.push({type:'Feature',properties:{color:'#ffffff'},geometry:{type:'MultiLineString',coordinates:frame.observationGeometry.coordinates}});
    return {type:'FeatureCollection',features};
  },[report,frame,forecast,mode]);
  const empty:FeatureCollection={type:'FeatureCollection',features:[]};
  const running=busy||job?.state==='queued'||job?.state==='running';
  async function loadJob(id:string){
    const sequence=++requestSequence.current;setBusy(true);setError('');setPlaying(false);
    try{const r=await fetch(`/api/replay/${id}`,{cache:'no-store'}),data=await r.json();if(!r.ok)throw Error(data.error);if(sequence===requestSequence.current){setJob(data);if(data.result?.kind==='synthetic')setShowSynthetic(true);const at=Number(new URLSearchParams(window.location.search).get('at'));setIndex(Math.max(0,data.result?.frames.findIndex((f:ReplayFrame)=>f.minute===at)??0));}}catch(e){if(sequence===requestSequence.current)setError(e instanceof Error?e.message:'Replay could not load.');}finally{if(sequence===requestSequence.current)setBusy(false);}
  }
  useEffect(()=>{let active=true;void fetch('/api/replay',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('Replay history unavailable.');return r.json();}).then(data=>{if(!active)return;setJobs(data.jobs);const id=new URLSearchParams(window.location.search).get('run');if(id)void loadJob(id);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;requestSequence.current++;};},[]);
  useEffect(()=>{
    if(!job||!['queued','running'].includes(job.state))return;
    const controller=new AbortController();let failures=0;
    const timer=setInterval(()=>{void fetch(`/api/replay/${job.id}`,{signal:controller.signal,cache:'no-store'}).then(async r=>{const data=await r.json();if(!r.ok)throw Error(data.error);if(!controller.signal.aborted){failures=0;setError('');setJob(data);if(data.state==='completed')setIndex(0);}}).catch(()=>{if(!controller.signal.aborted&&++failures>=3)setError('Connection interrupted. The replay may still be running. Reload to reconnect.');});},1000);
    return()=>{controller.abort();clearInterval(timer);};
  },[job?.id,job?.state]);
  useEffect(()=>{if(!playing||!report)return;const timer=setInterval(()=>setIndex(i=>{if(i>=report.frames.length-1){setPlaying(false);return i;}return i+1;}),1400);return()=>clearInterval(timer);},[playing,report]);
  async function start(input:unknown){
    ++requestSequence.current;setBusy(true);setPlaying(false);setError('');
    try{const r=await fetch('/api/replay',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}),data=await r.json();if(!r.ok)throw Error(data.error);setJob(data);setJobs(old=>[data,...old].slice(0,20));setIndex(0);window.history.replaceState(null,'',`/replay?run=${data.id}`);}catch(e){setError(e instanceof Error?e.message:'Replay could not start.');}finally{setBusy(false);}
  }
  async function importFile(file:File|undefined){if(!file)return;if(file.size>3_000_000){setError('Choose a replay JSON file smaller than 3 MB.');return;}try{await start(JSON.parse(await file.text()));}catch{setError('The file is not valid JSON. Download the example format below.');}finally{if(upload.current)upload.current.value='';}}
  return <section className="replay-shell replay-integrated"><MapLayers priority={1} center={report?.center||[1.7,41.7]} initialZoom={13} focusKey={mapFocus} selectedRadiusM={0} hotspots={empty} buildings={empty} landcover={empty} assets={empty} investigationOverlay={replayLayers} onSelectPoint={()=>{}}/>
    <div className="workspace-head replay-heading"><div><h1>Incident replay</h1><p>Review saved incidents against the observations recorded over time.</p></div><div className="replay-heading-actions"><button onClick={()=>upload.current?.click()} disabled={running}><Upload size={15}/> Import incident</button>{report&&<a href={`/api/replay/${job!.id}?download=1`}><Download size={15}/> Export results</a>}<input ref={upload} type="file" accept=".json,application/json" hidden onChange={e=>void importFile(e.target.files?.[0])}/></div></div>
    {error&&<div className="replay-error" role="alert">{error}</div>}
    {job?.state==='failed'&&<div className="replay-error" role="alert">{job.error||'Replay failed.'} Your input was not scored. Correct the input and import it again.</div>}
    <div className="replay-layout"><aside className="replay-sidebar"><div className="replay-side-label">REPLAY LIBRARY</div>
      {visibleJobs.length>0&&<div className="replay-history"><label htmlFor="replay-saved">Saved runs</label><select id="replay-saved" disabled={running} value={job?.id||''} onChange={e=>{window.history.replaceState(null,'',`/replay?run=${encodeURIComponent(e.target.value)}`);void loadJob(e.target.value);}}><option value="" disabled>Select an incident</option>{visibleJobs.map(j=><option key={j.id} value={j.id}>{j.name} · {j.kind==='synthetic'?'Synthetic · ':''}{new Date(j.createdAt).toLocaleDateString()} {time(j.createdAt)} UTC</option>)}</select></div>}
      {!visibleJobs.length&&<p className="replay-side-note">No saved historical incidents are available.</p>}
      {jobs.some(j=>j.kind==='synthetic')&&<label className="replay-synthetic-toggle"><input type="checkbox" checked={showSynthetic} onChange={e=>setShowSynthetic(e.target.checked)}/> Show synthetic exercises</label>}
      <div className="replay-protocol"><span className="replay-side-label">REQUIRED INCIDENT EVIDENCE</span><div><span>1</span><p><b>Initial fire boundary</b>A sourced perimeter and the time the incident replay begins.</p></div><div><span>2</span><p><b>Archived conditions</b>Terrain, fuel and weather from the incident period.</p></div><div><span>3</span><p><b>Later observations</b>Recorded fire boundaries with observation and availability times.</p></div></div>
      <a href="/api/replay?template=1" className="replay-template"><Download size={15}/> Download input template</a><p className="replay-side-note">The template contains synthetic sample values. Replace them with sourced incident evidence before importing a historical fire.</p>
      {report&&<div className="replay-run-facts"><span>{report.members.length} physical members</span><span>{(report.size**2).toLocaleString()} terrain cells</span><span>{report.frames.length} reference boundaries</span></div>}
    </aside><section className="replay-content" aria-busy={running}>
      {running?<div className="replay-progress" role="status"><div className="replay-orbits"><i/><i/><i/></div><span className="replay-eyebrow">COMPUTING ON THE BACKEND</span><h2>{job?.stage||'Preparing replay'}</h2><p>Running physical spread, then scoring each observation in time order.</p><div className="replay-progress-steps"><span><Check size={14}/> Frozen inputs</span><span>27 trajectories</span><span>Sequential evaluation</span></div></div>:report&&frame?<>
        <div className="replay-case-heading"><div><span className={'replay-kind '+report.kind}>{report.kind==='synthetic'?'SYNTHETIC EXERCISE':report.provenance.weatherKind==='archived-forecast'?'HISTORICAL REPLAY':'RETROSPECTIVE HINDCAST'}</span><h2>{report.name}</h2></div><span>{time(report.origin)} UTC origin<br/>{(report.runtimeMs/1000).toFixed(1)} s computation</span></div>
        <div className="replay-map-toolbar"><div className="replay-segment"><button aria-pressed={forecast==='baseline'} onClick={()=>setForecast('baseline')}>Frozen forecast</button><button aria-pressed={forecast==='updated'} onClick={()=>setForecast('updated')}>Updated forecast</button><button onClick={()=>setMapFocus(n=>n+1)}>Locate incident</button></div><div className="replay-segment" aria-label="Map display"><button aria-pressed={mode==='difference'} onClick={()=>setMode('difference')}>Forecast errors</button><button aria-pressed={mode==='agreement'} onClick={()=>setMode('agreement')}>Member agreement</button></div><span><Layers size={14}/> Reference boundary in white</span></div>
        <details className="replay-comparison"><summary>Compare forecast grids</summary><div className="replay-map-pair"><article><div className="replay-map-title"><div><span>FROZEN FORECAST</span><p>Every member has equal weight</p></div><b>{pct(frame.baseline.iou)}<small>overlap</small></b></div><ReplayMap report={report} frame={frame} updated={false} mode={mode}/></article><article><div className="replay-map-title updated"><div><span>UPDATED FORECAST</span><p>{frame.assimilated.length?`${frame.assimilated.length} earlier observations incorporated`:'No earlier observations available yet'}</p></div><b>{pct(frame.updated.iou)}<small>overlap</small></b></div><ReplayMap report={report} frame={frame} updated mode={mode}/></article></div></details>
        <div className="replay-legend">{mode==='difference'?<><span><i style={{background:colors.hit}}/>Matched burned area</span><span><i style={{background:colors.miss}}/>Missed by forecast</span><span><i style={{background:colors.extra}}/>Excess spread</span></>:<><span className="replay-gradient"/><span>Low → high weighted agreement</span><span>Uncalibrated</span></>}</div>
        <div className="replay-timeline"><button aria-label={playing?'Pause replay':'Play replay'} onClick={()=>{if(index===report.frames.length-1)setIndex(0);setPlaying(!playing);}}>{playing?<Pause size={18}/>:<Play size={18}/>}</button><div className="replay-scrubber"><div><b>+{frame.minute} minutes</b><span>{time(frame.at)} UTC · reference available {time(frame.availableAt)}</span></div><input aria-label="Replay observation" type="range" min={0} max={report.frames.length-1} step={1} value={index} onChange={e=>{setPlaying(false);setIndex(+e.target.value);}}/><div className="replay-ticks">{report.frames.map(f=><span key={f.at}>+{f.minute}m</span>)}</div></div><button aria-label="Restart replay" onClick={()=>{setIndex(0);setPlaying(false);}}><RotateCcw size={17}/></button></div>
        <div className="replay-evidence-strip"><span><Check size={15}/> Target observation is held out of this forecast</span><span>{frame.assimilated.length?`Uses observations at ${frame.assimilated.map(i=>`+${report.frames[i].minute}m`).join(', ')}`:'Both forecasts start with the same information'}</span></div>
        <div className="replay-detail-tabs" role="group" aria-label="Replay detail"><button aria-pressed={tab==='evaluation'} onClick={()=>setTab('evaluation')}>Evaluation</button><button aria-pressed={tab==='members'} onClick={()=>setTab('members')}>Member weights</button><button aria-pressed={tab==='method'} onClick={()=>setTab('method')}>Method & sources</button></div>
        {tab==='evaluation'?<div className="replay-evaluation"><MetricTable frame={frame}/><div><SkillChart report={report} index={index} onSelect={i=>{setIndex(i);setPlaying(false);}}/><div className="replay-arrival"><h3>Arrival timing</h3><strong>{num(frame.arrival.intervalErrorMinutes)} <small>min outside observed interval</small></strong><p>{frame.arrival.evaluatedCells} cells scored · {frame.arrival.noPredictedArrival} without a predicted arrival · {frame.arrival.rightCensoredCells} not yet observed burned.</p><p>Observations bound an arrival interval; they do not give an exact ignition time.</p></div></div></div>:tab==='members'?<div className="replay-members"><div className="replay-members-intro"><Wind size={21}/><div><h3>{num(frame.effectiveMembers)} effective members of {report.members.length}</h3><p>Earlier evidence redistributes weight. A concentrated bank can still be wrong.</p></div></div>{report.members.map((m,i)=><div className="replay-member" key={m.name}><span>{m.name}</span><div><i style={{width:`${Math.max(.3,frame.weights[i]*100)}%`}}/></div><b>{pct(frame.weights[i])}</b></div>)}</div>:<div className="replay-method"><h3>What was evaluated</h3><p>{report.method}</p><dl><dt>Weather</dt><dd>{report.provenance.weatherSource} · {report.provenance.weatherKind}</dd><dt>Issued</dt><dd>{report.provenance.weatherIssuedAt}</dd><dt>Landscape</dt><dd>{report.provenance.landscapeSource}</dd><dt>Current reference</dt><dd>{frame.source} · ±{frame.uncertaintyM} m supplied uncertainty</dd><dt>Physical engine</dt><dd>{report.engine}</dd><dt>Input fingerprint</dt><dd className="replay-hash">{report.inputSha256}</dd><dt>Event / split</dt><dd>{report.eventId} / {report.split}</dd></dl><a className="replay-template" href={`/api/replay/${job!.id}?input=1`}><Download size={15}/> Download this run’s frozen inputs</a><h3>How the update works</h3><p>Each earlier boundary receives a class-balanced mismatch score. Cells inside its uncertainty band are excluded from weighting. A fixed tempered likelihood and a 2% uniform mixture update member weights. Geometry metrics still score the full domain. The observed target is never used to update its own forecast.</p><h3>Limits that travel with this result</h3><ul>{report.warnings.map(w=><li key={w}>{w}</li>)}</ul></div>}
        <footer className="replay-footer"><FlaskConical size={15}/>{report.kind==='synthetic'?'Software evaluation on synthetic data. No real-world accuracy claim.':'Historical evaluation is not operational validation.'} Weighted agreement is not a calibrated probability.</footer>
      </>:<div className="replay-empty"><Layers size={32}/><h2>Select an incident to replay</h2><p>Choose a saved run or import an incident with archived weather, terrain and timestamped fire boundaries.</p><p>Live detections alone do not contain the historical evidence needed to replay an incident.</p><button className="replay-primary" onClick={()=>upload.current?.click()}><Upload size={16}/> Import incident</button></div>}
    </section></div>
  </section>;
}
