import type {MonitorZone} from './monitor';
import type {Assessment} from './assessment';

export type Intervention = {id:'zone-monitoring'|'asset-inspection'|'patrol-attention';title:string;reason:string;checks:string[]};
export type PreventionOpportunity = {
 score:number|null;status:'candidate'|'verify'|'unavailable';label:string;
 factors:{label:string;points:number;maximum:number;reason:string}[];
 interventions:Intervention[];gaps:string[];
};
const HOUR=3_600_000;
const fresh=(time:string|null|undefined,now:number,limit:number)=>!!time&&now-Date.parse(time)>=0&&now-Date.parse(time)<=limit;
const numeric=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);

/** A transparent planning index, not a probability or measured intervention effectiveness.
 * Coverage (30), identifiable checks (40), and forecast lead time (30) are product
 * weights. Missing evidence withholds the total rather than becoming low opportunity.
 */
export function preventionOpportunity(zone:MonitorZone,now=Date.now()):PreventionOpportunity {
 const weather=fresh(zone.updatedAt,now,30*60000)&&fresh(zone.evidence?.weatherRetrievedAt,now,20*60000)&&fresh(zone.evidence?.weatherValidAt,now,HOUR)&&[zone.temperature,zone.humidity,zone.windKmh].every(numeric);
 const satellite=fresh(zone.updatedAt,now,30*60000)&&fresh(zone.evidence?.satelliteRetrievedAt,now,30*60000)&&numeric(zone.hotspots)&&zone.hotspots>=0;
 const inventory=zone.exposure?.status==='ready'&&!!zone.exposure.counts;
 const counts=inventory?zone.exposure!.counts!:null;
 const assets=counts?counts.school+counts.healthcare+counts.complex:0;
 const access=counts?counts.road+counts.gathering:0;
 const start=Date.parse(zone.hazardWindow?.startsAt||'');
 const end=Date.parse(zone.hazardWindow?.endsAt||'');
 const window=weather&&Number.isFinite(start)&&Number.isFinite(end)&&end>now&&start<=now+24*HOUR;
 const leadHours=window?Math.max(0,(start-now)/HOUR):null;
 const thermal=satellite&&zone.hotspots!>0;
 const interventions:Intervention[]=[{id:'zone-monitoring',title:thermal?'Verify signals and monitor the zone':'Monitor this zone',reason:thermal?'Recent thermal signals require corroboration before treating this as a prevention-only situation.':window?'A forecast weather window gives a specific time to review monitoring coverage.':'Keep a named observation source and a next review time for this watch area.',checks:['Confirm camera or observation coverage and its latest timestamp','Assign the monitoring contact and next review time','Record changes and corroborate any thermal signal']}];
 if(assets>0)interventions.push({id:'asset-inspection',title:'Check infrastructure',reason:`${assets} mapped education, care or building-complex features provide candidates for inspection; condition and occupancy are unknown.`,checks:['Verify the mapped facility and responsible contact','Check vegetation contact, visible condition and access constraints','Record findings and candidate maintenance with the site manager']});
 if(window&&access>0&&!thermal)interventions.push({id:'patrol-attention',title:'Review increased patrol attention',reason:`${access} mapped road or gathering-place features offer locations to review before or during the weather window; access and staffing are unverified.`,checks:['Confirm local access and authorized patrol coverage','Review timing and available staff with the responsible coordinator','Record observations and the next handover time']});
 const factors=[
  {label:'Evidence coverage',points:(weather?15:0)+(satellite?15:0),maximum:30,reason:'15 points each for usable weather and satellite evidence.'},
  {label:'Identifiable checks',points:(assets>0?25:0)+(access>0?15:0),maximum:40,reason:'25 points for mapped facilities; 15 for roads or gathering places. More features do not add more points.'},
  {label:'Time to prepare',points:leadHours===null?0:leadHours>=6?30:leadHours>=2?20:leadHours>0?10:0,maximum:30,reason:leadHours===null?'No supported upcoming weather window; preparation time is unknown.':leadHours===0?'The weather window has started.':`${leadHours.toFixed(1)} hours until the weather window: 10 points below 2h, 20 at 2–6h, 30 at 6h or more.`},
 ];
 const gaps=[...(!weather?['Fresh weather evidence is missing.']:[]),...(!satellite?['Fresh satellite evidence is missing.']:[]),...(!inventory?['A current, covered infrastructure inventory is missing.']:[]),'Local access, staffing, ignition causes and intervention effectiveness are unverified.'];
 const score=weather&&satellite&&inventory&&!thermal?factors.reduce((sum,f)=>sum+f.points,0):null;
 return {score,status:thermal?'verify':score===null?'unavailable':'candidate',label:thermal?'Verify heat signals first':score===null?'Evidence needed':score>=70?'Stronger planning opportunity':score>=40?'Planning opportunity':'Limited supported opportunity',factors,interventions,gaps};
}

/** Location plans use the same rules, with their own assessment radius and evidence. */
export function assessmentOpportunity(a:Assessment,now=Date.now()):PreventionOpportunity {
 const weather=a.sources.find(s=>/Open-Meteo/i.test(s.source)&&s.status==='live');
 const satellite=a.sources.find(s=>/FIRMS|Deepfire|Satellite detections/i.test(s.source)&&s.status==='live');
 const windows=a.weather.outlook.filter(h=>Date.parse(h.time)+HOUR>now&&h.temperatureC>=28&&h.humidityPct<=25&&h.windKmh>=25).sort((x,y)=>Date.parse(x.time)-Date.parse(y.time));
 return preventionOpportunity({id:'location',name:'Location',position:[a.location.lon,a.location.lat],state:a.sage?.state??'monitoring',updatedAt:a.generatedAt,temperature:a.weather.current?.temperatureC??null,humidity:a.weather.current?.humidityPct??null,windKmh:a.weather.current?.windKmh??null,hotspots:satellite?a.satellite.hotspots.filter(h=>fresh(h.provenance.observedAt,now,6*HOUR)).length:null,reasons:[],exposure:a.exposure,evidence:{weatherValidAt:a.weather.current?.time??null,weatherRetrievedAt:weather?.retrievedAt??null,satelliteRetrievedAt:satellite?.retrievedAt??null,newestDetectionAt:null,weatherAgeMinutes:null,satelliteAgeMinutes:null,coverage:''},hazardWindow:windows.length?{startsAt:windows[0].time,endsAt:new Date(Date.parse(windows[0].time)+HOUR).toISOString()}:null},now);
}
