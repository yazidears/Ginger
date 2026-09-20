'use client';

import {useEffect, useState} from 'react';
import {ArrowUpRight, Check, MapPin, Pause, Play, RotateCcw} from 'lucide-react';
import {archivedIncidents, type ArchivedIncident} from '@/lib/replay/archive';
import MapLayers from './shared-map';

const empty = {type: 'FeatureCollection' as const, features: []};
const count = (value: number) => value.toLocaleString('en-GB');
const date = (value: string, timeZone: string) => new Date(value).toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric', timeZone});
const stamp = (value: string, timeZone: string) => new Date(value).toLocaleString('en-GB', {day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone, timeZoneName: 'short'});

export default function ReplayArchive({onEvaluation}: {onEvaluation: () => void}) {
  const [incident, setIncident] = useState(archivedIncidents[0]);
  const [index, setIndex] = useState(archivedIncidents[0].milestones.length - 1);
  const [playing, setPlaying] = useState(false);
  const [focus, setFocus] = useState(0);
  const milestones = incident.milestones;
  const current = milestones[index];
  const first = milestones[0], last = milestones[milestones.length - 1];

  useEffect(() => {
    function restore() {
      const params = new URLSearchParams(window.location.search);
      const selected = archivedIncidents.find(item => item.id === params.get('incident')) ?? archivedIncidents[0];
      const step = params.has('step') ? Number(params.get('step')) : selected.milestones.length - 1;
      setIncident(selected);
      setIndex(Number.isInteger(step) ? Math.max(0, Math.min(step, selected.milestones.length - 1)) : 0);
      setPlaying(false);
      setFocus(value => value + 1);
    }
    restore();
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  useEffect(() => {
    if (!playing) return;
    if (index === milestones.length - 1) { setPlaying(false); return; }
    const timer = setTimeout(() => {
      setIndex(index + 1);
      window.history.replaceState(null, '', `/replay?incident=${incident.id}&step=${index + 1}`);
    }, 1800);
    return () => clearTimeout(timer);
  }, [playing, index, milestones.length, incident.id]);

  function selectStep(step: number, selected: ArchivedIncident = incident) {
    setPlaying(false);
    setIncident(selected);
    setIndex(step);
    window.history.replaceState(null, '', `/replay?incident=${selected.id}&step=${step}`);
  }

  return <section className="replay-shell replay-integrated replay-archive">
    <MapLayers priority={1} center={incident.center} initialZoom={10} focusKey={focus} selectedRadiusM={0} hotspots={empty} buildings={empty} landcover={empty} assets={empty} investigationOverlay={empty} onSelectPoint={() => {}}/>
    <header className="workspace-head replay-heading">
      <div><h1>Incident replay</h1><p>Revisit past fires through the reports recorded as they unfolded.</p></div>
      <div className="replay-heading-actions"><button onClick={onEvaluation}>Model evaluation</button></div>
    </header>
    <div className="replay-layout">
      <aside className="replay-sidebar" aria-label="Past incidents">
        <div className="replay-side-label">PAST INCIDENTS <span>{archivedIncidents.length}</span></div>
        <div className="replay-archive-list">{archivedIncidents.map(item => {
          const start = item.milestones[0], end = item.milestones[item.milestones.length - 1];
          return <button key={item.id} className="replay-archive-card" aria-pressed={item.id === incident.id} onClick={() => {selectStep(item.milestones.length - 1, item); setFocus(value => value + 1);}}>
            <span>{new Date(start.at).getUTCFullYear()} <span>Contained</span></span>
            <strong>{item.name}</strong><small>{item.location}</small>
            <span>{count(end.acres!)} acres <span>{item.milestones.length} records</span></span>
          </button>;
        })}</div>
        <p className="replay-side-note">Curated CAL FIRE archive · California<br/>Source records checked 19 September 2026.</p>
      </aside>
      <section className="replay-content" aria-label={`${incident.name} timeline`}>
        <div className="replay-case-heading"><div><span className="replay-kind">HISTORICAL INCIDENT</span><h2>{incident.name}</h2><p className="replay-archive-location">{incident.location}</p></div>
          <span>{date(first.at, incident.timeZone)} – {date(last.at, incident.timeZone)}<br/>{milestones.length} archived records</span>
        </div>
        <div className="replay-archive-summary"><Check size={15}/><span>Final record · {count(last.acres!)} acres · 100% contained</span><button onClick={() => setFocus(value => value + 1)}><MapPin size={14}/> Locate incident</button></div>
        <article className="replay-record" aria-live="polite" aria-atomic="true">
          <span className="replay-eyebrow">RECORD {index + 1} OF {milestones.length} · {stamp(current.at, incident.timeZone)}</span>
          <h3>{current.title}</h3>
          <dl className="replay-record-metrics">
            <div><dt>Reported burned area</dt><dd>{current.acres === null ? 'Not reported' : <>{count(current.acres)} <small>acres</small></>}</dd></div>
            <div><dt>Containment</dt><dd>{current.containment === null ? 'Not reported' : `${current.containment}%`}</dd></div>
          </dl>
          <a href={current.source} target="_blank" rel="noreferrer">View CAL FIRE source <ArrowUpRight size={14}/></a>
        </article>
        <div className="replay-timeline">
          <button aria-label={playing ? 'Pause incident replay' : 'Play incident replay'} onClick={() => {if (index === milestones.length - 1) setIndex(0); setPlaying(!playing);}}>{playing ? <Pause size={18}/> : <Play size={18}/>}</button>
          <div className="replay-scrubber"><div><b>{date(current.at, incident.timeZone)}</b><span>Archived reports · Pacific time</span></div>
            <input aria-label="Historical incident timeline" aria-valuetext={stamp(current.at, incident.timeZone)} type="range" min={0} max={milestones.length - 1} step={1} value={index} onChange={event => selectStep(Number(event.target.value))}/>
            <div className="replay-ticks"><span>{date(first.at, incident.timeZone)}</span><span>{date(last.at, incident.timeZone)}</span></div>
          </div>
          <button aria-label="Restart incident replay" onClick={() => selectStep(0)}><RotateCcw size={17}/></button>
        </div>
        <div className="replay-records-heading"><h3>Incident timeline</h3><span>Select a record to jump to that date</span></div>
        <ol className="replay-records">{milestones.map((record, step) => <li key={record.at}>
          <button aria-current={step === index ? 'step' : undefined} onClick={() => selectStep(step)}>
            <span className="replay-record-dot"/><time dateTime={record.at}>{date(record.at, incident.timeZone)}</time>
            <strong>{record.title}</strong><span>{record.acres === null ? 'Area not reported' : `${count(record.acres)} acres`}</span>
          </button>
        </li>)}</ol>
        <footer className="replay-footer">Selected archived milestones, with gaps between reports. The map locates the incident; these records do not include changing fire boundaries or model forecasts.</footer>
      </section>
    </div>
  </section>;
}
