'use client';
import {exposureCategories, type ExposureSummary} from '@/lib/exposure/types';
export default function ExposureSummaryView({exposure, compact=false, onInspect}: {exposure?: ExposureSummary; compact?: boolean; onInspect?: (lon: number, lat: number, name: string) => void}) {
  if (!exposure) return <p className="small-source">Exposure inventory awaiting assessment.</p>;
  if (exposure.total === null) return <p className="small-source" role="status">{exposure.detail}</p>;
  return <details className="signal-evidence exposure-summary" open={compact ? undefined : true}>
    <summary>People & infrastructure · {exposure.total} mapped{exposure.uplift > 0 ? ` · +${exposure.uplift} priority` : ''}</summary>
    <p>{exposure.hazardActive ? `Exposure contribution: +${exposure.uplift}/40 priority points.` : 'No active weather or heat trigger. Exposure is recorded for readiness.'}</p>
    <dl className="exposure-counts">{exposure.contributions.map(c => <div key={c.category}><dt><i style={{background: exposureCategories[c.category].color}}/>{exposureCategories[c.category].label}</dt><dd>{c.count}{exposure.hazardActive && c.points > 0 ? ` · ${c.points} pts` : ''}</dd></div>)}</dl>
    <p className="small-source">Zone {(exposure.radiusM/1000).toFixed(1)} km + 1 km nearby buffer · {exposure.status}<br/>OSM source: {exposure.sourceDate?.slice(0,10)} · occupancy unknown</p>
    {!compact && <><p className="small-source">{exposure.detail}</p><ul className="exposure-places">{exposure.nearby.slice(0,12).map(f => {
      const g=f.geometry; const p=g.type==='Point'?g.coordinates:g.type==='LineString'?g.coordinates[0]:g.type==='Polygon'?g.coordinates[0][0]:g.coordinates[0][0][0];
      return <li key={f.properties.id}>{onInspect ? <button onClick={()=>onInspect(p[0],p[1],f.properties.name)}>{f.properties.name} ↗</button> : <span>{f.properties.name}</span>}<small>{exposureCategories[f.properties.category].label} · {f.properties.distanceM} m from centre</small></li>;
    })}</ul>{exposure.total>12&&<p className="small-source">Showing the 12 nearest records. Explore the map for more.</p>}</>}
  </details>;
}
