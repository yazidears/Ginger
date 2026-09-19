'use client';
import {EvidenceBadge} from './evidence';
import {useEffect, useRef, useState} from 'react';
import type {Evidence} from '@/lib/assessment';
import type {SageMessage} from '@/lib/sage/analysis';

type Reply = {answer: string; model: string; evidenceAt: string; sources: (Evidence & {id: string})[]};
type Exchange = {question: string; reply: Reply};
const prompts = ['What needs attention today?', 'When does the wind change?', 'What’s missing for a spread forecast?'];
const stamp = (value: string) => new Date(value).toLocaleString('en-GB', {timeZone: 'UTC', hour12: false}) + ' UTC';

export default function SageConversation({lat, lon, context='inspection'}: {lat: number; lon: number; context?:'prevention'|'inspection'}) {
  const [connection, setConnection] = useState<'checking' | 'ready' | 'unconfigured' | 'failed'>('checking');
  const [draft, setDraft] = useState('');
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/sage', {signal: controller.signal}).then(async r => {
      if (!r.ok) throw Error();
      const data = await r.json();
      setConnection(data.configured ? 'ready' : 'unconfigured');
    }).catch(() => {if (!controller.signal.aborted) setConnection('failed');});
    return () => {controller.abort(); active.current?.abort();};
  }, []);
  useEffect(() => {if (exchanges.length) bottom.current?.scrollIntoView({block: 'nearest'});}, [exchanges.length]);
  async function ask(question: string) {
    if (active.current || connection !== 'ready' || !question.trim()) return;
    const controller = new AbortController(); active.current = controller;
    setPending(true); setError('');
    const history: SageMessage[] = exchanges.slice(-6).flatMap(x => [{role: 'user', content: x.question}, {role: 'assistant', content: x.reply.answer.slice(0, 8000)}]);
    try {
      const response = await fetch('/api/sage', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({lat, lon, question, history}),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]),
      });
      const data = await response.json();
      if (!response.ok) {if (data.code === 'not_configured') setConnection('unconfigured'); throw Error(data.error || 'Analysis failed. Try again.');}
      if (controller.signal.aborted) return;
      setExchanges(prev => [...prev, {question, reply: data}]); setDraft('');
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error && e.name !== 'TimeoutError' ? e.message : 'Analysis timed out. Try again.');
    } finally {
      if (!controller.signal.aborted) {active.current = null; setPending(false);}
    }
  }
  function cancel() {active.current?.abort(); active.current = null; setPending(false);}
  return <section className="sage-conversation" aria-label="Ask Sage">
    <div className="sage-conversation-heading"><h3>Ask Sage</h3><span>{connection === 'ready' ? 'AI ENABLED' : connection === 'checking' ? 'CONNECTING' : 'AI OFFLINE'}</span></div>
    <EvidenceBadge kind="derived" detail="AI interpretation"/>
    {connection === 'unconfigured' && <p role="status" className="detail-note">AI is not connected. Live evidence is available below.</p>}
    {connection === 'failed' && <p role="status" className="detail-note">Could not check Sage’s connection. Reopen Sage to retry.</p>}
    {!exchanges.length && <div className="sage-prompts">{(context==='prevention'?['What should we check in this area today?', 'Which weather window needs extra monitoring?', 'Do the satellite signals need field verification?']:prompts).map(prompt => <button key={prompt} disabled={connection !== 'ready' || pending} onClick={() => {setDraft(prompt); void ask(prompt);}}>{prompt}<span aria-hidden="true">↗</span></button>)}</div>}
    <div className="sage-exchanges" aria-live="polite" aria-relevant="additions">
      {exchanges.map((exchange, i) => <article key={i} className="sage-exchange">
        <h4>{exchange.question}</h4><p className="sage-answer">{exchange.reply.answer}</p>
        <details><summary>Evidence used · {stamp(exchange.reply.evidenceAt)}</summary><p className="small-source">AI interpretation · {exchange.reply.model}</p>{exchange.reply.sources.map(source => <p key={source.id}><b>[{source.id}] {source.source} · {source.status}</b><br/>{source.detail}<br/><small>Retrieved {stamp(source.retrievedAt)}</small></p>)}</details>
      </article>)}
    </div>
    <div ref={bottom}/>
    <form onSubmit={event => {event.preventDefault(); void ask(draft);}}>
      <label htmlFor="sage-question">Your question</label>
      <textarea id="sage-question" value={draft} onChange={event => setDraft(event.target.value)} required name="question" maxLength={2000} rows={3} disabled={connection !== 'ready' || pending} placeholder="What changes overnight?"/>
      <div className="sage-composer-actions">{pending ? <button type="button" className="secondary-button" onClick={cancel}>Stop analysis</button> : <button className="primary-button" disabled={connection !== 'ready'}>Ask Sage <span aria-hidden="true">↗</span></button>}{exchanges.length > 0 && !pending && <button type="button" onClick={() => {setExchanges([]); setError('');}}>New conversation</button>}</div>
    </form>
    <p role="status" className="small-source">{pending ? 'Refreshing evidence and analysing this location…' : ''}</p>
    {error && <p role="alert" className="detail-note">{error}</p>}
    <p className="sage-conversation-caption">AI interpretation. Fire arrival and route safety need validation.</p>
  </section>;
}
