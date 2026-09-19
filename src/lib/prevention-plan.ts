import type {Assessment} from './assessment';
import {assessmentOpportunity} from './prevention-opportunity';
import {deriveIntelligence} from './intelligence';
export type PlanAction={id:string;title:string;category:'prevention'|'assets'|'coordination';priority:'routine'|'high';reason:string;checks:string[];evidenceAt:string;sourceNames:string[]};
/** Evidence-linked work proposals, not AI predictions or dispatch instructions. */
export function buildPreventionPlan(a:Assessment):PlanAction[]{
 const intelligence=deriveIntelligence(a);
 const base={evidenceAt:a.generatedAt,sourceNames:a.sources.filter(s=>s.status==='live').map(s=>s.source)};
 const actions:PlanAction[]=[];
 const thermal=intelligence.actions.some(x=>x.id==='verify-thermal');
 if(thermal)actions.push({...base,id:'verify-thermal',category:'prevention',priority:'high',title:'Verify recent heat signals',reason:intelligence.evidence.find(x=>x.id==='THERMAL')!.value,checks:['Check acquisition time and exact detection location','Compare with persistent heat sources and recent field reports','Record corroboration or uncertainty without declaring an all-clear']});
 const weather=intelligence.actions.some(x=>x.id==='weather-readiness');
 if(weather)actions.push({...base,id:'weather-readiness',category:'prevention',priority:'high',title:'Prepare for the weather window',reason:intelligence.evidence.find(x=>x.id==='PEAK')!.value,checks:['Check the forecast window against local weather observations','Confirm monitoring coverage and responsible contact','Schedule another check before conditions change']});
 if(intelligence.actions.some(x=>x.id==='restore-evidence'))actions.push({...base,id:'restore-evidence',category:'coordination',priority:'high',title:'Resolve evidence gaps',reason:'Some feeds are unavailable or forecast coverage is incomplete.',checks:['Identify missing sources in the assessment','Record an alternate observation source and its time','Reassess once fresh evidence is available']});
 if(intelligence.actions.some(x=>x.id==='inspect-dry-fuels'))actions.push({...base,id:'inspect-dry-fuels',category:'prevention',priority:'high',title:'Inspect extremely dry fine fuels',reason:intelligence.evidence.find(x=>x.id==='DRYNESS')!.value,checks:['Verify dead grass, leaf litter and fine-fuel moisture in the field','Record fuel continuity near buildings and access roads','Check the forecast timing and record any local rain or shade differences']});
 const geoLive=a.sources.some(s=>s.source.includes('OpenStreetMap')&&s.status==='live');
 const assets=geoLive?a.geography.assets.features:[];
 if(a.exposure?.total)actions.push({...base,id:'regional-exposure',category:'assets',priority:a.exposure.uplift?'high':'routine',title:'Review nearby people and infrastructure',reason:`${a.exposure.total} mapped features inside the inspection zone and 1 km buffer; +${a.exposure.uplift}/40 exposure priority. Inventory ${a.exposure.status}, source ${a.exposure.sourceDate}.`,sourceNames:[...base.sourceNames,'OpenStreetMap / Geofabrik'],checks:['Verify schools, healthcare facilities and residential or work complexes','Confirm actual occupancy and busy periods; map categories are proxies','Check major-road access and closures with responsible operators']});
 actions.push({...base,id:'asset-inspection',category:'assets',priority:thermal?'high':'routine',title:'Inspect vulnerable assets',reason:geoLive?`${assets.length} mapped facilities and ${a.geography.buildings.features.length} buildings within 1.5 km. Proximity does not establish exposure.`:'Asset coverage is missing. Start by verifying the local inventory.',checks:[...(assets.length?[`Verify ${assets.slice(0,3).map(f=>String(f.properties?.name||'mapped facility').slice(0,60)).join(', ')}`]:['Locate facilities and verify the inventory']), 'Record vegetation contact, access constraints and visible building condition','Confirm occupancy and responsible contacts; leave unknowns explicit']});
 actions.push({...base,id:'mitigation-review',category:'prevention',priority:'routine',title:'Plan mitigation checks',reason:a.planningContext?.zones.length?`Planning reference: ${a.planningContext.zones.map(z=>z.name).join(', ')} (${a.planningContext.edition}). Historical context, not current danger.`:'Fuel conditions and mitigation effectiveness need site evidence.',checks:['Inspect vegetation continuity and record fuel/moisture observations','Identify candidate maintenance work with the land manager','Compare a baseline and intervention scenario with explicit assumptions']});
 actions.push({...base,id:'access-review',category:'coordination',priority:thermal?'high':'routine',title:'Verify access and handover',reason:geoLive?`${a.geography.roads.features.length} mapped road segments; closures, capacity and suitability are unknown.`:'Access-road inventory is unavailable.',checks:['Verify gates, closures and access constraints through an authorized source','Assign a responsible person and next review time','Record findings and unresolved questions for the next shift']});
 for(const intervention of assessmentOpportunity(a).interventions){
  if(actions.some(action=>action.id===intervention.id))continue;
  actions.push({...base,...intervention,category:'prevention',priority:thermal||intervention.id==='patrol-attention'?'high':'routine'});
 }
 return actions;
}
