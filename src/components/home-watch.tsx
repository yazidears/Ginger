'use client';
import Link from 'next/link';
import {useEffect, useState} from 'react';
import {ArrowLeft, ArrowRight, BellRing, Check, Home, MapPin, MessageCircle, Search} from 'lucide-react';
import type {HomeLocation} from '@/lib/home-geocoding';
import HomeWatchMap from './home-watch-map';
import './home-watch.css';

type SavedHome = {id: string; name: string; lat: number; lon: number; radiusM: number};
type HomeWatchZone = {id: string; state: 'monitoring' | 'review' | 'escalating' | 'unavailable'; reasons: string[]; updatedAt: string; hotspots: number | null; temperature: number | null; hazardWindow?: {startsAt: string; endsAt: string} | null};
const labels = {monitoring: 'Monitoring', review: 'Needs review', escalating: 'High · escalating conditions', unavailable: 'Evidence unavailable'};
export default function HomeWatch({contact}: {contact: string | null}) {
  const [step, setStep] = useState<'address' | 'confirm' | 'connect'>('address');
  const [query, setQuery] = useState(''), [results, setResults] = useState<HomeLocation[]>([]), [searched, setSearched] = useState(false);
  const [point, setPoint] = useState<HomeLocation | null>(null), [name, setName] = useState('My home'), [radius, setRadius] = useState('3000');
  const [confirmed, setConfirmed] = useState(false), [repeat, setRepeat] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [saved, setSaved] = useState<SavedHome | null>(null), [zone, setZone] = useState<HomeWatchZone | null>(null), [copied, setCopied] = useState(false);
  const [manualLat, setManualLat] = useState(''), [manualLon, setManualLon] = useState('');
  useEffect(() => {
    if (!saved) return;
    const controller = new AbortController();
    let active = true;
    async function refresh() {
      try {const r = await fetch('/api/monitor', {signal: controller.signal}); if (!r.ok) throw Error(); const data = await r.json(); if (active) setZone(data.zones?.find((z: HomeWatchZone) => z.id === saved!.id) ?? null);}
      catch {if (active) setZone(null);}
    }
    void refresh(); const timer = setInterval(() => void refresh(), 60_000);
    return () => {active = false; controller.abort(); clearInterval(timer);};
  }, [saved]);
  async function search(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setResults([]); setSearched(false);
    try {
      const r = await fetch('/api/home-search', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({query})});
      const data = await r.json(); if (!r.ok) throw Error(data.error); setResults(data.locations); setSearched(true);
    } catch (e) {setError(e instanceof Error ? e.message : 'Could not search. Try again.');} finally {setBusy(false);}
  }
  function choose(p: HomeLocation) {setPoint(p); setConfirmed(false); setError(''); setStep('confirm');}
  function coordinates(e: React.FormEvent) {
    e.preventDefault(); const lat = Number(manualLat), lon = Number(manualLon);
    if (!manualLat.trim() || !manualLon.trim() || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) {setError('Enter valid latitude and longitude.'); return;}
    choose({lat, lon, label: 'Location entered with coordinates'});
  }
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!point || !confirmed) return; setBusy(true); setError('');
    try {
      const r = await fetch('/api/watch-areas', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name, lat: point.lat, lon: point.lon, radiusM: Number(radius)})});
      const data = await r.json(); if (!r.ok) throw Error(data.error); setSaved(data.area); setStep('connect');
    } catch (e) {setError(e instanceof Error ? e.message : 'Could not save your home. Try again.');} finally {setBusy(false);}
  }
  const command = saved ? `WATCH ${saved.id}${repeat ? ' REPEAT' : ''}` : '';
  const fresh = zone && Date.now() - Date.parse(zone.updatedAt) <= 20 * 60_000 && Date.parse(zone.updatedAt) <= Date.now();
  const limited = zone?.state === 'review' && !zone.hotspots && !zone.hazardWindow && (zone.temperature === null || zone.hotspots === null);
  return <main className="home-watch">
    <header className="home-watch-header"><Link href="/" className="home-watch-brand"><img src="/ginger-symbol.svg" alt=""/>GINGER</Link><Link href="/"><ArrowLeft size={15}/> Back to the map</Link></header>
    <div className="home-watch-layout"><section className="home-watch-intro"><span className="home-kicker">HOME WATCH</span><h1>A watch on the place<br/>you call home.</h1><p>Nearby fire observations. Changing weather. A message when your watch needs attention.</p><div className="home-watch-explainer"><Home size={22}/><div><strong>Your place, your alerts.</strong><p>Confirm your home on the map, then send one message to start your watch.</p></div></div><ol className="home-watch-steps" aria-label="Setup progress">{(['address', 'confirm', 'connect'] as const).map((s, i) => <li key={s} aria-current={step === s ? 'step' : undefined}><span>{i + 1}</span>{['Find your home', 'Confirm the location', 'Connect Messages'][i]}</li>)}</ol><p className="home-watch-note">Ginger checks weather and satellite feeds about every ten minutes while the backend runs. Satellite observations are intermittent. Alerts describe evidence near your home; they cannot predict whether your house will burn.</p></section>
    <section className="home-watch-card" aria-label="Home watch setup">
      {step === 'address' && <><div className="home-card-title"><MapPin size={22}/><h2>Where should we watch?</h2></div><form onSubmit={search}><label htmlFor="home-address">Street address and town</label><div className="home-search-row"><input id="home-address" autoComplete="street-address" required minLength={5} maxLength={250} placeholder="Street, house number, town" value={query} onChange={e => setQuery(e.target.value)}/><button className="home-primary" disabled={busy}><Search size={17}/>{busy ? 'Finding…' : 'Find'}</button></div><p className="home-field-help">Searching sends this address to our geocoding provider. Address results use <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> data.</p></form>{searched && !results.length && <p role="status">No matching addresses. Add a postcode or use coordinates below.</p>}<div className="home-search-results">{results.map((p, i) => <button key={i} onClick={() => choose(p)}><MapPin size={17}/><span>{p.label}<small>{p.lat.toFixed(5)}, {p.lon.toFixed(5)}</small></span><ArrowRight size={17}/></button>)}</div><details className="home-manual"><summary>Use coordinates instead</summary><form onSubmit={coordinates}><div className="home-fields"><label>Latitude<input required type="number" step="any" min={-85} max={85} value={manualLat} onChange={e => setManualLat(e.target.value)} placeholder="41.39000"/></label><label>Longitude<input required type="number" step="any" min={-180} max={180} value={manualLon} onChange={e => setManualLon(e.target.value)} placeholder="2.17000"/></label></div><button className="home-secondary">Confirm on map <ArrowRight size={15}/></button></form></details></>}
      {step === 'confirm' && point && <><button className="home-back" onClick={() => {setStep('address'); setError('');}}><ArrowLeft size={15}/> Change address</button><div className="home-card-title"><MapPin size={22}/><h2>Put the pin on your home.</h2></div><p className="home-address-label">{point.label}</p><HomeWatchMap lat={point.lat} lon={point.lon} onMove={(lat, lon) => {setPoint({...point, lat, lon}); setConfirmed(false);}}/><p className="home-field-help">Click the map or drag the pin to correct the location.</p><form onSubmit={save}><div className="home-fields"><label>Latitude<input aria-label="Pin latitude" type="number" step="any" required min={-85} max={85} value={point.lat} onChange={e => {if (e.target.value && Number.isFinite(Number(e.target.value)) && Math.abs(Number(e.target.value)) <= 85) {setPoint({...point, lat: Number(e.target.value)}); setConfirmed(false);}}}/></label><label>Longitude<input aria-label="Pin longitude" type="number" step="any" required min={-180} max={180} value={point.lon} onChange={e => {if (e.target.value && Number.isFinite(Number(e.target.value)) && Math.abs(Number(e.target.value)) <= 180) {setPoint({...point, lon: Number(e.target.value)}); setConfirmed(false);}}}/></label></div><div className="home-fields"><label>Place nickname<input required maxLength={80} value={name} onChange={e => setName(e.target.value)}/></label><label>Watch within<select value={radius} onChange={e => setRadius(e.target.value)}><option value="1000">1 km</option><option value="3000">3 km</option><option value="5000">5 km</option><option value="10000">10 km</option></select></label></div><label className="home-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/><span>This pin marks the location I want to watch.</span></label><p className="home-field-help">The nickname and pin are saved in this shared Ginger workspace and visible to its users. The full address is not saved. Use a nickname you are comfortable sharing.</p><button className="home-primary home-wide" disabled={!confirmed || busy}>{busy ? 'Saving…' : 'Save location & connect Messages'}<ArrowRight size={17}/></button></form></>}
      {step === 'connect' && saved && <><div className="home-saved"><Check size={15}/> Location saved · messages not yet subscribed</div><div className="home-card-title"><MessageCircle size={22}/><h2>{contact ? 'Let Ginger text you.' : 'Your home is saved.'}</h2></div><p>{contact ? <>Send this command from your iPhone to link <strong>{saved.name}</strong> to your conversation. Ginger will reply when your subscription is active.</> : <>Ginger can monitor <strong>{saved.name}</strong> here. Text alerts are not active yet because this workspace’s messaging service still needs to be connected.</>}</p><label className="home-repeat"><input type="checkbox" checked={repeat} onChange={e => {setRepeat(e.target.checked); setCopied(false);}}/><span><strong>Repeat high-priority alerts</strong><small>When nearby detections coincide with hazardous weather, send up to three reminders, five minutes apart. Reply ACK to stop them.</small></span><BellRing size={19}/></label>{contact && <div className="home-command"><code>{command}</code><button className="home-secondary" onClick={async () => {try {await navigator.clipboard.writeText(command); setCopied(true);} catch {setError('Copy the command above manually.');}}}>{copied ? 'Copied' : 'Copy command'}</button></div>}{contact ? <><a className="home-primary home-wide" href={`sms:${contact}&body=${encodeURIComponent(command)}`}>Open Messages <ArrowRight size={17}/></a><p className="home-field-help">Send to {contact}. Opening Messages does not send or subscribe automatically.</p></> : <p className="home-connection-pending" role="status">Messaging setup required. No texts or reminders will be sent until Ginger’s sender is connected and you subscribe from your phone.</p>}{contact && <p className="home-field-help">If Ginger says the area is not found, allow the next backend scan to finish, then send the command again. Reply ACK to acknowledge current reminders, or STOP to stop all updates. Sending WATCH without REPEAT turns reminders off.</p>}<div className="home-current"><span>CURRENT WATCH</span><strong>{fresh ? limited ? 'Monitoring limited · missing data' : labels[zone.state] : 'Waiting for fresh monitoring data'}</strong><p>{fresh && limited ? 'This status reflects missing monitoring data, not a detected threat to your home. ' : ''}{fresh ? zone.reasons[0] : 'The backend must be running to check this saved location.'}</p>{fresh && <small>Scan: {new Date(zone.updatedAt).toLocaleString()}</small>}</div><Link className="home-manage" href="/prevention?tool=areas">Manage saved watch areas <ArrowRight size={14}/></Link></>}
      {error && <p className="home-error" role="alert">{error}</p>}
    </section></div>
  </main>;
}
