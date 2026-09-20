'use client';

import {useEffect, useRef, useState} from 'react';
import {ArrowLeft, ArrowRight, Check, Home, Hospital, MapPin, School, Search, ShieldCheck} from 'lucide-react';
import type {HomeLocation, PlaceType} from '@/lib/home-geocoding';
import HomeWatchMap from './home-watch-map';
import './ash-connect.css';

type SavedPlace = {id: string; name: string; placeType?: PlaceType; subscribed: boolean; enhanced: boolean; code?: string; expiresAt: number};
type Connection = {connected: boolean; contact: string | null; channel: 'imessage' | 'whatsapp' | 'telegram'};
const types = [{id: 'home', label: 'Home', icon: Home}, {id: 'school', label: 'School', icon: School}, {id: 'hospital', label: 'Hospital', icon: Hospital}] as const;

export default function AshConnect() {
  const [query, setQuery] = useState(''), [results, setResults] = useState<HomeLocation[]>([]);
  const [place, setPlace] = useState<HomeLocation | null>(null), [type, setType] = useState<PlaceType>('home');
  const [saved, setSaved] = useState<SavedPlace | null>(null), [connection, setConnection] = useState<Connection | null>(null);
  const [busy, setBusy] = useState(false), [searched, setSearched] = useState(false), [error, setError] = useState('');
  const restored = useRef(false), mutationVersion = useRef(0), mutating = useRef(false);
  const [owned, setOwned] = useState<SavedPlace[]>([]), [verified, setVerified] = useState(false);
  const selectedType = saved?.placeType || type;
  const enhanced = selectedType === 'school' || selectedType === 'hospital';
  useEffect(() => {
    let active = true, refreshSequence = 0; const abort = new AbortController();
    async function refresh() {
      if (mutating.current) return;
      const version = mutationVersion.current, sequence = ++refreshSequence;
      const isCurrent = () => active && !mutating.current && version === mutationVersion.current && sequence === refreshSequence;
      try {
        const [response, resident] = await Promise.all([
          fetch('/api/ash-connect', {cache: 'no-store', signal: abort.signal}),
          fetch('/api/ash-connect/resident', {cache: 'no-store', signal: abort.signal}),
        ]);
        if (!response.ok) throw Error();
        const data = await response.json();
        if (isCurrent()) setConnection(data);
        if (!resident.ok) {if (isCurrent()) setVerified(false); return;}
        const homes: SavedPlace[] = (await resident.json()).homes;
        if (isCurrent()) {
          setOwned(homes); setVerified(true); const shouldRestore = !restored.current;
          setSaved(current => current ? homes.find(h => h.id === current.id) || null : shouldRestore ? homes.at(-1) || null : null);
          restored.current = true;
        }
      } catch {if (isCurrent()) {setConnection(null); setVerified(false);}}
    }
    void refresh(); const timer = setInterval(() => void refresh(), 10_000);
    return () => {active = false; abort.abort(); clearInterval(timer);};
  }, []);
  async function search(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setResults([]); setSearched(false);
    try {const response = await fetch('/api/home-search', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({query})}); const data = await response.json(); if (!response.ok) throw Error(data.error); setResults(data.locations); setSearched(true);}
    catch (e) {setError(e instanceof Error ? e.message : 'Could not find that address.');} finally {setBusy(false);}
  }
  async function save() {
    if (!place || busy || mutating.current) return; mutationVersion.current++; mutating.current = true; setBusy(true); setError('');
    try {
      const response = await fetch('/api/ash-connect/resident', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name: place.label.split(',')[0].slice(0,80), lat: place.lat, lon: place.lon, radiusM: 3000, placeType: type})});
      const data = await response.json(); if (!response.ok) throw Error(data.error); setSaved(data.home); setOwned(current => [...current, data.home]); setVerified(true); restored.current = true;
    } catch (e) {setError(e instanceof Error ? e.message : 'Could not save this place.');} finally {mutating.current = false; setBusy(false);}
  }
  async function renew() {
    if (!saved || busy || mutating.current) return; mutationVersion.current++; mutating.current = true; setBusy(true); setError('');
    try {
      const response = await fetch('/api/ash-connect/resident', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({areaId: saved.id})});
      const data = await response.json(); if (!response.ok) throw Error(data.error);
      setSaved(data.home); setOwned(current => current.map(h => h.id === data.home.id ? data.home : h)); setVerified(true);
    } catch (e) {setError(e instanceof Error ? e.message : 'Could not prepare a new connection.');} finally {mutating.current = false; setBusy(false);}
  }
  const subscribed = !!connection?.connected && verified && !!saved?.subscribed;
  const enhancedActive = subscribed && !!saved?.enhanced;
  const ready = connection?.connected && connection.contact;
  const channelName = connection?.channel === 'telegram' ? 'Telegram' : connection?.channel === 'whatsapp' ? 'WhatsApp' : 'iMessage';
  const code = saved?.code && saved.expiresAt > Date.now() ? saved.code : null;
  const message = code ? `CONNECT ${code}` : '';
  const link = connection?.channel === 'telegram' ? `https://t.me/${connection.contact}?start=CONNECT_${code}` : connection?.channel === 'whatsapp'
    ? `https://wa.me/${connection.contact}?text=${encodeURIComponent(message)}`
    : `sms:${connection?.contact}&body=${encodeURIComponent(message)}`;
  return <main className="ash-connect">
    <section className="connect-card" aria-label="AshConnect" aria-busy={busy}>
      <div className="connect-title"><span className="connect-symbol"><MapPin size={20} aria-hidden="true"/></span><h1>AshConnect</h1></div>
      {!place && !saved ? <>
        {owned.length > 0 && <div className="connect-results" aria-label="Your saved places">{owned.map(home => <button key={home.id} onClick={() => {setSaved(home); setError('');}}><MapPin size={16} aria-hidden="true"/><span>{home.name}</span><ArrowRight size={15} aria-hidden="true"/></button>)}</div>}
        <form className="connect-search" onSubmit={search}><label htmlFor="connect-address">Your address</label><div><input id="connect-address" aria-describedby={error ? "connect-error" : undefined} aria-invalid={!!error} required minLength={5} maxLength={250} autoComplete="street-address" placeholder="Address, school or hospital" value={query} onChange={e => {setQuery(e.target.value); setSearched(false); setResults([]);}}/><button type="submit" disabled={busy} aria-label="Find address"><Search size={19}/></button></div></form>
        {busy && <p className="connect-note" role="status">Finding your place…</p>}
        {searched && !results.length && <p className="connect-note" role="status">No results. Add a town or postcode.</p>}
        <div className="connect-results">{results.map((result,i) => <button key={i} onClick={() => {setPlace(result); setType(result.placeType || 'home'); setError('');}}><MapPin size={16} aria-hidden="true"/><span>{result.label}</span><ArrowRight size={15} aria-hidden="true"/></button>)}</div>
      </> : place && !saved ? <>
        <button className="connect-back" onClick={() => {setPlace(null); setError('');}} disabled={busy}><ArrowLeft size={14} aria-hidden="true"/> Change address</button>
        <p className="connect-address">{place.label}</p>
        <div className="connect-map"><HomeWatchMap lat={place.lat} lon={place.lon} onMove={(lat,lon) => setPlace({...place,lat,lon})}/></div>
        <div className="connect-types" role="group" aria-label="Place type">{types.map(({id,label,icon: Icon}) => <button key={id} type="button" aria-pressed={type === id} disabled={busy} onClick={() => setType(id)}><Icon size={16} aria-hidden="true"/>{label}</button>)}</div>
        {enhanced && <p className="connect-enhanced"><ShieldCheck size={16} aria-hidden="true"/> Enhanced notifications selected</p>}
        <button className="connect-primary" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Confirm location'}<ArrowRight size={16} aria-hidden="true"/></button>
      </> : saved ? <>
        <div className="connect-saved"><Check size={22} aria-hidden="true"/><h2>{saved.name}</h2></div>
        <p className={enhancedActive ? 'connect-enhanced' : 'connect-note'} role="status">{enhancedActive ? <><ShieldCheck size={16} aria-hidden="true"/> Enhanced notifications enabled</> : subscribed && !enhanced ? 'Notifications enabled' : enhanced ? 'Enhanced notifications selected' : 'Location saved'}</p>
        {(!subscribed || (enhanced && !enhancedActive)) && (ready ? code ? <><a className="connect-primary" href={link}>Enable {channelName} notifications <ArrowRight size={16} aria-hidden="true"/></a><p className="connect-note">Send the prepared message. This page confirms when your conversation is connected. The link expires after 15 minutes.</p></> : <><button className="connect-primary" disabled={busy} onClick={() => void renew()}>{busy ? 'Preparing…' : 'Get a new connection link'}<ArrowRight size={16} aria-hidden="true"/></button><p className="connect-note">Connect your conversation to enable notifications for this place.</p></> : <p className="connect-note">Messaging connection pending. Your place is saved in this browser.</p>)}
        {subscribed && <p className="connect-note">Your conversation is connected. Reply STOP in {channelName} to turn off updates.</p>}
        <button className="connect-back" onClick={() => {setSaved(null); setPlace(null); setQuery(''); setResults([]); setSearched(false); setError('');}}>Add another place</button>
      </> : null}
      {error && <p id="connect-error" className="connect-error" role="alert">{error}</p>}
      {!saved && <footer className="connect-footer"><span className={ready ? 'is-ready' : ''}><i/>{ready ? `${channelName} ready` : 'Messaging setup pending'}</span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a></footer>}
    </section>
  </main>;
}
