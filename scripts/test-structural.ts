import assert from 'node:assert/strict';
import {simulateLandscape} from '../src/lib/sage/engine';
import {hydrateMapElements,parseBuildingFootprints} from '../src/lib/sage/building-inventory';
import {mergeBuildings} from '../src/lib/sage/landscape';
import {cellPolygon,localPolygons,contains,distanceBetweenParts} from '../src/lib/sage/geometry';
import {validateRunRequest} from '../src/lib/sage/validation';
import type {Landscape,RunRequest} from '../src/lib/sage/types';
const origin='2026-09-19T12:00:00Z',center:[number,number]=[2.17665,41.37948];
const request:RunRequest={lat:center[1],lon:center[0],horizonMinutes:60,ignitionRadiusM:25,deadMoisturePct:7,liveMoisturePct:90,windAdjustment:.35,mode:'scenario',confirmation:'',solarDrying:false,structural:{maxGapM:20,transferMinutes:15}};
const fixture=():Landscape=>({center,size:20,cellM:25,elevations:Array(400).fill(10),buildings:{type:'FeatureCollection',features:[0,40,80,200].map((x,i)=>({type:'Feature',geometry:cellPolygon(x,0,10,center),properties:{id:`b${i}`,name:`Building ${i}`,heightM:null,source:'test'}}))},landcover:{type:'FeatureCollection',features:[{type:'Feature',geometry:cellPolygon(0,0,250,center),properties:{categoria:'Casc urbà'}}]},weather:Array.from({length:6},(_,i)=>({time:new Date(Date.parse(origin)+i*3600000).toISOString(),temperatureC:30,humidityPct:20,windKmh:30,windFromDegrees:270,directNormalWm2:600,diffuseWm2:100,precipitationMm:0})),sources:[],warnings:[]});
let count=0;function test(name:string,fn:()=>void){fn();console.log('PASS',name);count++;}
test('urban fire starts in a building and transfers across buildings without vegetation',()=>{
 const result=simulateLandscape(fixture(),request,'urban',()=>{},origin);
 assert.deepEqual(result.buildings.map(b=>b.structuralIgnitionByMember?.[0]),[0,15,30,null]);
 assert.equal(result.buildings[0].status,'structural-ignition');assert.equal(result.stats.burnedHa,0);assert.equal(result.cells.features.length,0);assert.equal(result.stats.reached,3);
 assert.match(result.assumptions.join(' '),/operator assumptions/);
});
test('gap, delay, horizon and disabled structural mode change connectivity as declared',()=>{
 const land=fixture();assert.throws(()=>simulateLandscape(land,{...request,structural:undefined},'surface',()=>{},origin),/no mapped burnable/);
 const narrow=simulateLandscape(land,{...request,structural:{maxGapM:5,transferMinutes:15}},'narrow',()=>{},origin);assert.equal(narrow.stats.reached,1);
 const slow=simulateLandscape(land,{...request,structural:{maxGapM:20,transferMinutes:40}},'slow',()=>{},origin);assert.equal(slow.stats.reached,2);assert.equal(slow.buildings[1].structuralIgnitionByMember?.[0],40);
});
test('burning building can seed nearby vegetation after the chosen transfer delay',()=>{
 const land=fixture();land.landcover.features[0].properties={categoria:'Prats'};
 const result=simulateLandscape(land,{...request,ignitionRadiusM:1,structural:{maxGapM:30,transferMinutes:7}},'mixed',()=>{},origin);
 assert.ok(result.cells.features.length>0);assert.equal(Math.min(...result.cells.features.map(f=>f.properties!.arrivalCentral as number).filter(t=>typeof t==='number')),7);
});
test('vegetation can transfer fire into buildings without an initially burning structure',()=>{
 const land=fixture();land.landcover.features[0].properties={categoria:'Prats'};
 const result=simulateLandscape(land,{...request,structural:{maxGapM:30,transferMinutes:7},experiment:{parentId:'fixture',windOffset:0,windFactor:1,windShiftMinutes:0,ignitionOffset:[-150,0]}},'reverse',()=>{},origin);
 const building=result.buildings.find(b=>b.id==='b0')!;assert.ok(building.structuralIgnitionByMember![0]!==null);assert.ok(building.structuralIgnitionByMember![0]!>=7);
});
test('unknown cover is not invented, but does not disable a mapped urban scenario',()=>{
 const land=fixture();land.landcover.features=[];
 const result=simulateLandscape(land,request,'unknown',()=>{},origin);assert.equal(result.stats.reached,3);assert.equal(result.stats.fuelCoveragePct,0);assert.match(result.warnings.join(' '),/unknown fuel/);
});
test('structural validation rejects unbounded gaps, zero delay and coercion',()=>{
 assert.deepEqual(validateRunRequest(request).structural,request.structural);
 for(const structural of [{maxGapM:51,transferMinutes:10},{maxGapM:20,transferMinutes:0},{maxGapM:'10',transferMinutes:15},{maxGapM:NaN,transferMinutes:15},null])assert.throws(()=>validateRunRequest({...request,structural}));
});
const g=(points:number[][])=>points.map(([lon,lat])=>({lon,lat}));
test('building multipolygons assemble split outer ways, retain holes, and deduplicate member ways',()=>{
 const outer=[[0,0],[4,0],[4,4],[0,4],[0,0]],hole=[[1,1],[2,1],[2,2],[1,2],[1,1]];
 const relation={type:'relation',id:1,tags:{building:'yes',type:'multipolygon'},members:[{type:'way',ref:10,role:'outer',geometry:g(outer.slice(0,3))},{type:'way',ref:11,role:'outer',geometry:g([outer[0],outer[3],outer[2]])},{type:'way',ref:12,role:'inner',geometry:g(hole)}]};
 const result=parseBuildingFootprints([relation,{type:'way',id:10,tags:{building:'yes'},geometry:g(outer)}]);
 assert.equal(result.features.length,1);const parts=localPolygons(result.features[0].geometry,[0,0]);
 assert.equal(contains([0,0],parts),true);assert.equal(result.features[0].geometry.type,'MultiPolygon');assert.equal((result.features[0].geometry as GeoJSON.MultiPolygon).coordinates[0].length,2);assert.equal(result.features[0].properties?.heightM,null);
 assert.equal(parseBuildingFootprints([{...relation,members:relation.members.slice(0,1)}]).features.length,0);
});
test('bounded OSM map fallback resolves node references and never joins missing nodes',()=>{
 const points=[[0,0],[1,0],[1,1],[0,0]],nodes=points.slice(0,3).map(([lon,lat],i)=>({type:'node',id:i+1,lon,lat}));
 const way={type:'way',id:10,nodes:[1,2,3,1],tags:{building:'yes'}};
 const features=parseBuildingFootprints(hydrateMapElements([...nodes,way]));assert.equal(features.features.length,1);
 assert.equal(parseBuildingFootprints(hydrateMapElements([...nodes.slice(0,2),way])).features.length,0);
 const relation={type:'relation',id:11,tags:{building:'yes',type:'multipolygon'},members:[{type:'way',ref:10,role:'outer'}]};
 assert.equal(parseBuildingFootprints(hydrateMapElements([...nodes,way,relation])).features.length,1);
});
test('overlapping inventories deduplicate while adjacent shared-wall buildings remain distinct',()=>{
 const make=(x:number,id:string)=>({type:'Feature' as const,geometry:cellPolygon(x,0,10,center),properties:{id}});
 const merged=mergeBuildings({type:'FeatureCollection',features:[make(0,'icgc-same'),make(20,'icgc-next')]},{type:'FeatureCollection',features:[make(0,'osm')]},center);
 assert.deepEqual(merged.features.map(f=>f.properties?.id),['osm','icgc-next']);
 assert.ok(Math.abs(distanceBetweenParts(localPolygons(make(0,'a').geometry,center),localPolygons(make(40,'b').geometry,center))-20)<1e-6);
});
console.log(`${count} structural and footprint checks passed`);
