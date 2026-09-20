'use client';
import type {ForecastExposure} from '@/lib/product-contracts';
import type {RunResult} from '@/lib/sage/types';
import {exposureAtMinute} from '@/lib/sage/forecast-exposure-summary';

export default function SageConsequences({exposure,minute,result,selected,onSelect,error}:{exposure:ForecastExposure|null;minute:number;result:RunResult;selected:string|null;onSelect:(id:string|null)=>void;error:string}) {
  const summary=exposure?exposureAtMinute(exposure,minute):null;
  const asset=exposure?.assets.features.find(feature=>feature.properties.id===selected)?.properties;
  const rows=exposure?.assets.features.map(feature=>feature.properties).filter(asset=>asset.arrivalMinMinutes!==null).sort((a,b)=>(a.arrivalCentralMinutes??Infinity)-(b.arrivalCentralMinutes??Infinity))??[];
  return <div className="sage-result-scroll sage-consequences">
    {asset?<>
      <button type="button" className="sage-back" onClick={()=>onSelect(null)}>← Consequences</button>
      <span className="sage-context-label">MODELLED EXPOSURE · {asset.category==='road'?'ROAD SEGMENT':asset.category.toUpperCase()}</span>
      <h2>{asset.name}</h2>
      <p className="sage-conclusion">{asset.arrivalCentralMinutes===null?'Outside the central projection.':asset.arrivalCentralMinutes<=minute?`Reached by the central projection at +${asset.arrivalCentralMinutes} min.`:`Central projection reaches this geometry at +${asset.arrivalCentralMinutes} min.`}</p>
      <p className="small-source">{asset.category==='road'?'Projected exposure; no closure or safe-access determination.':'Projected exposure; no confirmed damage or occupancy estimate.'} {asset.coverage==='partial'?'Geometry extends beyond model coverage.':''}</p>
      <details><summary>Why this is highlighted</summary><p>Its mapped geometry intersects calculated fire cells or a modelled building footprint in run {result.id}. Highlighting follows the central member and current simulation minute.</p><p>Sensitivity range: {asset.arrivalMinMinutes===null?'Not reached':`+${asset.arrivalMinMinutes}–${asset.arrivalMaxMinutes} min`} across {asset.membersReached}/{result.members.length} reaching members. This is not a confidence interval.</p></details>
      <details><summary>Evidence & assumptions</summary><p>{asset.source} · {asset.sourceUrl?<a href={asset.sourceUrl} target="_blank" rel="noreferrer">source record ↗</a>:'identity in run snapshot'}</p><p>Forecast origin {result.forecastOrigin}. Inventory {exposure?.inventory.sourceDate??'date unavailable'}. {exposure?.status} coverage.</p><p>{result.engine}</p>{result.assumptions.map(assumption=><p key={assumption}>{assumption}</p>)}{exposure?.limitations.map(limit=><p key={limit}>{limit}</p>)}</details>
    </>:<>
      <span className="sage-context-label">CONSEQUENCES AT +{Math.floor(minute)} MIN</span>
      <h2>{summary?.counts?`${summary.central.length} mapped ${summary.central.length===1?'asset':'assets'} reached`:error?'Exposure unavailable':exposure?'Exposure cannot be assessed':'Loading exposure inventory…'}</h2>
      <p className="small-source">Central projection · {exposure?.status??'loading'}. Mapped objects are not people. Select a highlight or an asset below.</p>
      {summary?.counts&&<dl className="sage-consequence-counts"><div><dt>Facilities / areas</dt><dd>{summary.counts.complex+summary.counts.gathering}</dd></div><div><dt>Schools</dt><dd>{summary.counts.school}</dd></div><div><dt>Healthcare</dt><dd>{summary.counts.healthcare}</dd></div><div><dt>Road segments</dt><dd>{summary.roadSegments}</dd></div></dl>}
      <details><summary>Coverage & interpretation</summary><p>{summary?.namedRoads??'Unknown'} identified road identities; {summary?.unidentifiedRoadSegments??'unknown'} segments have no road identity. Segments are never counted as distinct roads.</p>{exposure?.limitations.map(limit=><p key={limit}>{limit}</p>)}<p>Outside a projection does not establish safety. Counts reflect this inventory and run only.</p></details>
    </>}
    {error&&<p role="status" className="detail-note">{error}. Missing inventory is not zero exposure.</p>}
    <details className="sage-asset-list" open={!asset}><summary>Affected assets · whole run ({rows.length})</summary>{rows.slice(0,120).map(row=><button type="button" key={row.id} aria-pressed={selected===row.id} onClick={()=>onSelect(row.id)}><span>{row.name}<small>{row.category==='road'?'Road segment':row.category} · {row.coverage}</small></span><b>{row.arrivalCentralMinutes===null?'Sensitivity only':`+${row.arrivalCentralMinutes}m`}</b></button>)}{rows.length>120&&<p>First 120 by central exposure. Select other highlighted geometry on the map.</p>}{summary?.counts&&!rows.length&&<p>No intersections in the available inventory; this does not establish complete coverage or safety.</p>}</details>
  </div>;
}
