import type {Assessment} from '@/lib/assessment';
import {drynessLabel} from '@/lib/vegetation-dryness';
import {EvidenceBadge} from './evidence';

const time=(value:string)=>new Date(value).toLocaleString('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})+' UTC';

export default function VegetationDrynessCard({assessment,hour=0}:{assessment:Assessment|null;hour?:number}){
 const dryness=assessment?.vegetationDryness;
 const weatherLive=assessment?.sources.some(s=>s.source==='Open-Meteo'&&s.status==='live');
 const age=dryness?.current?Date.now()-Date.parse(dryness.current.time):Infinity;
 const ready=dryness?.status==='estimated'&&weatherLive&&age>=0&&age<2*3600000;
 const frame=ready?dryness.outlook[hour]:undefined;
 return <article className="feed-entry evidence-card" data-evidence="simulated" aria-label="Vegetation dryness">
  <EvidenceBadge kind="simulated" detail="Weather-derived moisture"/>
  <h3>Vegetation dryness</h3>
  {frame?<>
   <p><strong className={frame.level==='extremely_dry'?'red-text':undefined}>{drynessLabel(frame.level)}</strong> · {hour===0?'Current estimate':`Forecast +${hour}h`}</p>
   <p><strong>{frame.moisturePct.toFixed(1)}%</strong> estimated dead fine-fuel moisture, by dry mass.</p>
   <p className="small-source">{time(frame.time)} · Dead grass, leaves and other fine fuels where present.</p>
   {dryness?.driest&&<p>Lowest in this outlook: {dryness.driest.moisturePct.toFixed(1)}% · {time(dryness.driest.time)}.</p>}
   {frame.level==='extremely_dry'&&<p>Check local fuel conditions and vegetation near vulnerable assets.</p>}
  </>:<p>{!dryness?'Dryness estimate pending a fresh assessment.':dryness.status==='unavailable'?dryness.detail:'Dryness estimate is stale or its weather source is unavailable. Refresh needed.'}</p>}
  <p className="small-source">Live plant moisture is not measured. This estimate does not confirm ignition or fire.</p>
  {dryness&&<details><summary>Method and limits</summary><p>{dryness.source} · {dryness.historyHours} hours of usable history.</p>{dryness.limitations.map(text=><p key={text}>{text}</p>)}<a href="https://natural-resources.canada.ca/forests-forestry/wildland-fires/canada-fire-weather-index-system" target="_blank" rel="noreferrer">About the Fine Fuel Moisture Code ↗</a></details>}
 </article>;
}
