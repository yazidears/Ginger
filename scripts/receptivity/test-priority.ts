import assert from 'node:assert/strict';
import {assessPriorities,currentThermals,thermalConfidence} from '../../src/lib/receptivity/priority';
import type {CellResult,Snapshot,StationResult} from '../../src/lib/receptivity/types';
import type {Hotspot} from '../../src/lib/providers/types';
const now=Date.parse('2026-09-19T12:00:00Z');
const stamp=(minutes=0)=>new Date(now-minutes*60000).toISOString();
const counts={school:0,healthcare:0,complex:0,road:0,gathering:0};
function cell(id='utm31-200-420000-4600000'):CellResult{return {id,center:[2.1,41.4],ring:[],name:'Example forest',fuel:{type:'Tree cover',burnableFraction:.9,continuity:.9,fractions:{},source:'fixture',epoch:'2021'},terrain:{slope:5},localExposure:{status:'ready',sourceDate:stamp(),counts:{...counts},rangeM:1100,nearestM:null},stationId:'A',stationDistanceKm:1,confidence:.6,confidenceLabel:'limited',receptivity:[68,68,68,68,68,68],spread:[20,20,20,20,20,20],velocity:0};}
function station():StationResult{return {station:{id:'A',name:'Test station',center:[2.1,41.4],elevation:10},frames:[0,1,3,6,12,24].map(horizon=>({horizon,timestamp:stamp(-horizon*60),fineFuelMoisture:13.8,spreadPotential:20,fireReceptivity:68,conditions:{windSpeed:10}})) as StationResult['frames'],history:{continuousHours:72},forecastIssuedAt:stamp(),forecastSource:'fixture',quality:[]};}
function snapshot(cells=[cell()]):Snapshot{return {cells,stations:[station()],generatedAt:stamp(),horizons:[0,1,3,6,12,24],cellSizeM:200,satellite:{status:'live',source:'fixture',retrievedAt:stamp(),detail:'fixture',observations:[]},heatwaves:[]} as unknown as Snapshot;}
function hotspot(id='a',minutes=30,confidence='nominal'):Hotspot{return {id,position:[2.1,41.4],clusterId:null,frpMw:10,confidence,provenance:{source:'VIIRS',observedAt:stamp(minutes),retrievedAt:stamp(),mode:'live'}};}
function result(s:Snapshot,index=0){return assessPriorities(s,index,now).byCell.get(s.cells[0].id)!;}
// Same weather, different mapped local support. No manufactured red cells on a uniformly dry day.
const ordinary=cell(),steep=cell('utm31-200-424000-4600000');steep.terrain.slope=25;
const pair=snapshot([ordinary,steep]), assessment=assessPriorities(pair,0,now);
assert.equal(assessment.byCell.get(ordinary.id)?.level,'routine');assert.equal(assessment.byCell.get(steep.id)?.level,'watch');
assert.equal(assessment.counts.verify,0);assert.equal(assessment.counts.review,0);
const windy=snapshot([steep]);windy.stations[0].frames[0].conditions.windSpeed=30;
assert.equal(result(windy).level,'review');
const exposed=cell();exposed.localExposure!.counts!.school=1;
assert.equal(result(snapshot([exposed])).level,'watch');
exposed.localExposure!.sourceDate=stamp(31*24*60);assert.equal(result(snapshot([exposed])).level,'unknown');
const sparse=cell();sparse.fuel.continuity=.2;sparse.terrain.slope=30;assert.equal(result(snapshot([sparse])).level,'routine');
// Unknown data cannot be converted into an all-clear, nor can old weather amplify a signal.
const missing=snapshot();missing.satellite!.status='unavailable';assert.equal(result(missing).level,'unknown');
const old=snapshot([steep]);old.stations[0].frames[0].timestamp=stamp(91);assert.equal(result(old).level,'unknown');
const thermal=snapshot();thermal.satellite!.observations=[hotspot()];assert.equal(result(thermal).level,'review');
thermal.satellite!.observations=[hotspot('a',30,'high')];assert.equal(result(thermal).level,'verify');
thermal.stations[0].frames[0].timestamp=stamp(91);assert.equal(result(thermal).level,'review');
// Low/unknown confidence is retained for watch, never upgraded by duplicate pixels or FRP.
for(const confidence of ['low','UNKNOWN','99']){const s=snapshot();s.satellite!.observations=[hotspot('a',30,confidence),hotspot('b',15,confidence)];s.satellite!.observations[0].frpMw=1000;assert.equal(result(s).level,'watch');}
assert.equal(thermalConfidence({...hotspot('modis',30,'85'),provenance:{...hotspot().provenance,source:'MODIS'}}),'high');
const repeat=snapshot();repeat.satellite!.observations=[hotspot('a',30),hotspot('copy',30)];assert.equal(currentThermals(repeat,now).length,1);assert.equal(result(repeat).level,'review');
repeat.satellite!.observations.push({...hotspot('adjacent',30),position:[2.1001,41.4]});assert.equal(result(repeat).thermal?.periods,1);
repeat.satellite!.observations.push(hotspot('later',15));assert.equal(result(repeat).level,'verify');assert.equal(result(repeat).thermal?.periods,2);
// Feed expiry, acquisition expiry, demo, future and invalid locations all suppress current claims.
for(const minutes of [361,-1]){const s=snapshot();s.satellite!.observations=[hotspot('a',minutes,'high')];assert.equal(result(s).level,'routine');}
const stale=snapshot();stale.satellite!.observations=[hotspot('a',20,'high')];stale.satellite!.retrievedAt=stamp(31);assert.equal(result(stale).level,'unknown');
const demo=snapshot();demo.satellite!.observations=[{...hotspot(),provenance:{...hotspot().provenance,mode:'demo'}}];assert.equal(currentThermals(demo,now).length,0);
// A single event is one area, even when several cells or station inputs overlap it.
const neighbours=[cell(),cell('utm31-200-420200-4600000')];neighbours[1].center=[2.102,41.4];
const grouped=snapshot(neighbours);grouped.satellite!.observations=[hotspot('a',20,'high')];assert.equal(assessPriorities(grouped,0,now).areas.length,1);assert.equal(assessPriorities(grouped,0,now).areas[0].cells,2);
// Forecast weather updates priority. Current satellite evidence never becomes a future detection.
const future=snapshot([steep]);future.stations[0].frames[5].conditions.windSpeed=30;assert.equal(result(future,0).level,'watch');assert.equal(result(future,5).level,'review');
future.stations[0].forecastIssuedAt=stamp(361);assert.equal(result(future,5).level,'unknown');
const unchanged=snapshot();unchanged.satellite!.observations=[hotspot('a',30,'high')];assert.equal(result(unchanged,5).thermal?.latestAt,stamp(30));
// Strong evidence is retained even when a closer observation is weaker.
const mixed=snapshot();mixed.satellite!.observations=[{...hotspot('weak',30,'low'),position:[2.089,41.4]}, {...hotspot('strong',15,'high'),position:[2.109,41.4]}];assert.equal(result(mixed).level,'verify');assert.equal(result(mixed).thermal?.confidence,'high');
const roadside=cell(),care=cell('utm31-200-430000-4600000');roadside.localExposure!.counts!.road=1;care.localExposure!.counts!.healthcare=1;
assert.equal(assessPriorities(snapshot([roadside,care]),0,now).areas[0].cell.id,care.id,'Vulnerable infrastructure leads equally supported reviews');
console.log('PASS local differentiation, combined weather, exposure freshness, missing coverage, confidence, observation periods, deduplication, expiry, grouping and forecast separation');
