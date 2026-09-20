import {PRIORITY, type AreaPriority} from '@/lib/receptivity/priority';

export default function PriorityDetail({priority: p, horizon}: {priority: AreaPriority; horizon: number}) {
  return <section className="r-priority-detail" aria-label="Local review assessment">
    <p className="r-eyebrow">LOCAL REVIEW · {horizon ? `WEATHER +${horizon}H` : 'NOW'}</p>
    <h3 style={{color: PRIORITY[p.level].color}}>{PRIORITY[p.level].label}</h3>
    <ul>{p.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
    {p.thermal && <p className="r-thermal-time">Observed {new Date(p.thermal.latestAt).toLocaleString('en-GB', {timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short'})} · current evidence at every forecast horizon. A thermal signal needs verification.</p>}
    <p className="r-priority-action">{p.action}</p>
    {!!p.missing.length && <p className="r-priority-missing">Missing or stale: {p.missing.join(' · ')}.</p>}
  </section>;
}
