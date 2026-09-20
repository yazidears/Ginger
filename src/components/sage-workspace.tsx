'use client';

import {useEffect, useMemo, useState} from 'react';
import {useRouter, useSearchParams} from 'next/navigation';
import {ChevronDown, ExternalLink, FolderOpen, MapPin, Plus, X} from 'lucide-react';
import type {ScenarioContext} from '@/lib/product-contracts';
import type {RunRequest, RunState} from '@/lib/sage/types';
import type {DetectionSnapshot} from '@/lib/detections';
import SageSimulation from './sage-simulation';
import {capturedSolarAvailable} from '@/lib/sage/solar-input';
import './simulation-morph.css';

type SavedRun = Pick<RunState, 'id' | 'state' | 'createdAt' | 'request'> & {name?:string|null};
type Chooser = 'scenarios' | 'evidence' | 'incident' | 'new' | null;
const DEFAULT_CENTER: [number, number] = [2.094, 41.43];
const date = (value: string) => new Date(value).toLocaleString('en-GB', {day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC'}) + ' UTC';
function position(lat: string | null, lon: string | null): [number, number] {
  const latitude = Number(lat), longitude = Number(lon);
  return lat !== null && lon !== null && Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= 40.53 && latitude <= 42.86 && longitude >= .16 && longitude <= 3.30 ? [longitude, latitude] : DEFAULT_CENTER;
}
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {...init, cache: 'no-store'});
  const body = await response.json();
  if (!response.ok) throw Error(body.error || 'Evidence unavailable. Retry when the source is ready.');
  return body;
}

export default function SageWorkspace() {
  const router = useRouter(), query = useSearchParams();
  const scenarioId = query.get('scenario'), runId = query.get('sageRun');
  const [scenario, setScenario] = useState<ScenarioContext | null>(null);
  const [currentRun, setCurrentRun] = useState<RunState | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [chooser, setChooser] = useState<Chooser>(null), [runs, setRuns] = useState<SavedRun[]>([]);
  const [detections, setDetections] = useState<DetectionSnapshot | null>(null);
  const [chooserBusy, setChooserBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const directCenter = position(query.get('lat'), query.get('lon'));
  const [lat, setLat] = useState(String(directCenter[1])), [lon, setLon] = useState(String(directCenter[0]));
  const [name, setName] = useState(''), [source, setSource] = useState(''), [observedAt, setObservedAt] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setScenario(null); setError('');
    if (!scenarioId) { setLoading(false); return; }
    setLoading(true);
    void request<{scenario: ScenarioContext}>(`/api/scenarios/${encodeURIComponent(scenarioId)}`, {signal: controller.signal})
      .then(data => { if (!controller.signal.aborted) setScenario(data.scenario); })
      .catch(reason => { if (!controller.signal.aborted) setError((reason as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [scenarioId]);

  useEffect(() => {
    if (chooser !== 'scenarios' && chooser !== 'evidence') return;
    const controller = new AbortController();
    setChooserBusy(true); setError('');
    const load = chooser === 'scenarios'
      ? request<SavedRun[]>('/api/sage/runs', {signal: controller.signal}).then(setRuns)
      : request<DetectionSnapshot>('/api/detections?region=catalonia', {signal: controller.signal}).then(setDetections);
    void load.catch(reason => { if (!controller.signal.aborted) setError((reason as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setChooserBusy(false); });
    return () => controller.abort();
  }, [chooser]);

  useEffect(() => {
    if (!chooser) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setChooser(null); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [chooser]);

  const center = currentRun?.result?.center ?? scenario?.center ?? directCenter;
  const initialRequest = useMemo<RunRequest>(() => ({
    lat: scenario?.center[1] ?? directCenter[1], lon: scenario?.center[0] ?? directCenter[0],
    horizonMinutes: 120, ignitionRadiusM: 50,
    deadMoisturePct: scenario?.inputs.deadMoisturePct ?? 7,
    liveMoisturePct: scenario?.inputs.liveMoisturePct ?? 90,
    windAdjustment: .35, solarDrying: capturedSolarAvailable(scenario),
    mode: scenario?.basis === 'confirmed-incident' ? 'confirmed' : 'scenario',
    confirmation: scenario?.incident?.confirmation === 'confirmed' ? scenario.incident.confirmationBasis : '',
    scenarioId: scenario?.id,
    structural: {maxGapM: 10, transferMinutes: 20},
  }), [scenario, directCenter[0], directCenter[1]]);

  async function createContext(body: Record<string, unknown>, endpoint = '/api/scenarios') {
    setCreating(true); setError('');
    try {
      const data = await request<{scenario: ScenarioContext}>(endpoint, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
      setChooser(null); router.push(`/sage?scenario=${encodeURIComponent(data.scenario.id)}`);
    } catch (reason) { setError((reason as Error).message); }
    finally { setCreating(false); }
  }

  function createScenario(event: React.FormEvent) {
    event.preventDefault();
    if (chooser === 'incident') {
      void createContext({name, source, observedAt: new Date(observedAt).toISOString(), lat: Number(lat), lon: Number(lon), confirmed}, '/api/incidents');
    } else void createContext({name: name || 'Hypothetical scenario', lat: Number(lat), lon: Number(lon)});
  }

  const activeScenario = currentRun?.result?.scenario ?? scenario;
  const basis = currentRun?.request.mode === 'confirmed' || activeScenario?.basis === 'confirmed-incident' ? 'Operator-confirmed' : 'Hypothetical';
  const stale = activeScenario?.evidence.some(item => item.status === 'stale');
  const partial = activeScenario?.evidence.some(item => item.coverage !== 'full' || item.status === 'unavailable');
  const specialistQuery = new URLSearchParams(query.toString());
  if(activeScenario)specialistQuery.set('scenario',activeScenario.id);
  specialistQuery.set('lat', String(center[1])); specialistQuery.set('lon', String(center[0]));

  return <div className={`sage-console app-shell sage-suite map-first shared-map-shell simulation-mode ${chooser ? 'is-choosing' : ''}`}>
    <div className="sage-context-bar" aria-label="Sage context">
      <button className="sage-context-select" onClick={() => setChooser(chooser === 'scenarios' ? null : 'scenarios')} aria-expanded={chooser === 'scenarios'}>
        <FolderOpen size={15}/><span>{activeScenario?.name || (runId ? 'Saved forecast' : 'Scenario')}</span><ChevronDown size={14}/>
      </button>
      <span className="product-qualifier">{basis}</span>
      {stale && <span className="product-qualifier warning">Stale</span>}
      {partial && <span className="product-qualifier warning">Partial</span>}
      <button onClick={() => setChooser(chooser === 'evidence' ? null : 'evidence')} aria-expanded={chooser === 'evidence'}>Live evidence</button>
      <button onClick={()=>router.push(`/sage?${specialistQuery}&engine=terrain-wind`)}>3D terrain wind & fire</button>
      <button onClick={()=>router.push('/sage?engine=terrain-wind&run=c41b7bf820e449178dc73fdd3dd3caa1&lat=41.43&lon=2.094')}>Try prepared 3D demo · saved scenario</button>
    </div>

    {loading ? <div className="sage-context-notice" role="status">Loading the saved input snapshot…</div>
      : scenarioId && !scenario ? <div className="sage-context-notice" role="alert">{error || 'This scenario is unavailable.'}<button onClick={() => router.push('/sage')}>Choose another scenario</button></div>
      : <SageSimulation key={scenario?.id || `${directCenter[0]},${directCenter[1]}`} cinematic scenario={scenario ?? undefined} initialRequest={initialRequest} savedRunId={runId ?? undefined} onRunChange={setCurrentRun} location={{lat: center[1], lon: center[0], name: scenario?.name || (query.has('lat') ? 'Selected location' : 'Collserola')}} assessment={null} onBack={() => router.push('/prevent')}/>}

    {chooser && <section className="sage-context-drawer" role="dialog" aria-modal="false" aria-labelledby="sage-context-title">
      <header><div><span className="product-eyebrow">SAGE</span><h2 id="sage-context-title">{chooser === 'scenarios' ? 'Scenarios & forecasts' : chooser === 'evidence' ? 'Live incident evidence' : chooser === 'incident' ? 'Record an incident' : 'New scenario'}</h2></div><button className="product-close" aria-label="Close context drawer" onClick={() => setChooser(null)}><X size={18}/></button></header>
      {chooserBusy && <p role="status">Loading evidence…</p>}
      {error && <p className="product-error" role="alert">{error}</p>}
      {chooser === 'scenarios' && <>
        <button className="product-primary" onClick={() => {setName(''); setChooser('new');}}><Plus size={16}/>New hypothetical scenario</button>
        <div className="sage-saved-list">{runs.filter(run => run.state === 'completed').map(run => <button key={run.id} onClick={() => {const next = new URLSearchParams(); next.set('sageRun', run.id); if (run.request.scenarioId) next.set('scenario', run.request.scenarioId); setChooser(null); router.push(`/sage?${next}`);}}>
          <strong>{run.name||'Unnamed location'}</strong>
          <span>{run.request.mode==='confirmed'?'Operator-confirmed':'Hypothetical'} · {run.request.horizonMinutes / 60}h</span><small>Created {date(run.createdAt)} · {run.id.slice(0, 8)}</small>
        </button>)}</div>
        {!chooserBusy && !runs.some(run => run.state === 'completed') && <p>No completed forecasts saved. Choose a location and inspect its assumptions before running.</p>}
        <details className="sage-specialists"><summary>Specialist capabilities</summary><p>Shared location; each engine retains its own assumptions.</p><a href={`/forest?${specialistQuery}`}>Forest / ELMFIRE <ExternalLink size={13}/></a><a href={`/satellite?${specialistQuery}`}>Satellite evidence <ExternalLink size={13}/></a><a href={`/replay?${specialistQuery}`}>Forecast replay <ExternalLink size={13}/></a></details>
      </>}
      {chooser === 'evidence' && <>
        <p>Thermal observations need confirmation. Explore their possible consequences as a hypothetical scenario.</p>
        <button className="product-secondary" onClick={() => {setName(''); setSource(''); setConfirmed(false); setChooser('incident');}}>Record operator-confirmed incident</button>
        {detections && <><span className="product-qualifier">{detections.status === 'live' ? 'Observed' : detections.status === 'stale' ? 'Stale' : 'Unavailable'}</span><div className="sage-saved-list">{detections.hotspots.slice(0, 20).map(hotspot => <button key={hotspot.id} disabled={creating} onClick={() => void createContext({thermalId: hotspot.id})}>
          <strong>Unconfirmed thermal · {hotspot.position[1].toFixed(3)}, {hotspot.position[0].toFixed(3)}</strong><span>{date(hotspot.provenance.observedAt)} · {hotspot.provenance.source}</span><small>Explore hypothetically →</small>
        </button>)}</div>{!detections.hotspots.length && <p>No recent thermal observations in this feed. This does not establish that the area is clear.</p>}<details><summary>Source coverage</summary><p>{detections.detail}</p><p>Retrieved {detections.retrievedAt ? date(detections.retrievedAt) : 'unknown'}</p></details></>}
      </>}
      {(chooser === 'new' || chooser === 'incident') && <form className="sage-context-form" onSubmit={createScenario}>
        <label>{chooser === 'incident' ? 'Incident name / identity' : 'Scenario name'}<input required={chooser === 'incident'} minLength={chooser === 'incident' ? 3 : undefined} maxLength={120} value={name} onChange={event => setName(event.target.value)}/></label>
        <div><label>Latitude<input required type="number" step="any" min="40.53" max="42.86" value={lat} onChange={event => setLat(event.target.value)}/></label><label>Longitude<input required type="number" step="any" min="0.16" max="3.30" value={lon} onChange={event => setLon(event.target.value)}/></label></div>
        {chooser === 'incident' && <><label>Confirmation source / reference<input required minLength={5} maxLength={240} value={source} onChange={event => setSource(event.target.value)}/></label><label>Observation time · your local time<input required type="datetime-local" value={observedAt} onChange={event => setObservedAt(event.target.value)}/></label><label className="product-check"><input required type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/>I am recording an operator-confirmed incident.</label><p>No observed perimeter provided. The initial radius remains a scenario assumption.</p></>}
        <button className="product-primary" disabled={creating}><MapPin size={16}/>{creating ? 'Saving context…' : chooser === 'incident' ? 'Use incident context' : 'Establish scenario'}</button>
        <small>Review the inputs before computing a forecast.</small>
      </form>}
    </section>}
  </div>;
}
