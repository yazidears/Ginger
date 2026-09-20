import assert from 'node:assert/strict';
import {demoIgnitionRequest} from '../src/lib/demo-sandbox';
import {simulateLandscape} from '../src/lib/sage/engine';
import {cellPolygon} from '../src/lib/sage/geometry';
import type {Landscape,RunRequest} from '../src/lib/sage/types';

const settings:RunRequest={lat:41.3,lon:1.86,horizonMinutes:60,ignitionRadiusM:25,deadMoisturePct:7,liveMoisturePct:90,windAdjustment:.35,mode:'confirmed',confirmation:'OLD-INCIDENT',solarDrying:false,structural:{maxGapM:20,transferMinutes:15},experiment:{parentId:'6cb87543-c242-499a-8c60-a4d2f67b12f3',windOffset:0,windFactor:1,windShiftMinutes:0,ignitionOffset:[100,0]}};
const request=demoIgnitionRequest(settings,1.83,41.73);
assert.equal(request.lat,41.73);assert.equal(request.lon,1.83);
assert.equal(request.mode,'scenario');assert.equal(request.confirmation,'');
assert.equal(request.experiment,undefined,'Moving the fire must not reuse a different geographic snapshot');
assert.deepEqual(request.structural,settings.structural);
assert.equal(request.deadMoisturePct,settings.deadMoisturePct);
assert.equal(request.horizonMinutes,settings.horizonMinutes);
assert.equal(settings.lon,1.86,'The previous request is immutable');
for(const [lon,lat] of [[1.8,90],[180,41],[NaN,41],[1.8,Infinity]])assert.throws(()=>demoIgnitionRequest(settings,lon,lat));
assert.throws(()=>demoIgnitionRequest({...settings,ignitionRadiusM:0},1.83,41.73));

// Run the demo-generated request through the production SAGE solver. These
// deterministic test fixtures test the engine connection, not live source access.
const origin='2026-09-19T12:00:00Z',center:[number,number]=[request.lon,request.lat];
const land:Landscape={center,size:20,cellM:25,elevations:Array(400).fill(100),buildings:{type:'FeatureCollection',features:[0,40,80,200].map((x,i)=>({type:'Feature',geometry:cellPolygon(x,0,10,center),properties:{id:`b${i}`,name:`Fixture building ${i}`,heightM:null,source:'test fixture'}}))},landcover:{type:'FeatureCollection',features:[{type:'Feature',geometry:cellPolygon(0,0,250,center),properties:{categoria:'Casc urbà'}}]},weather:Array.from({length:6},(_,i)=>({time:new Date(Date.parse(origin)+i*3600000).toISOString(),temperatureC:30,humidityPct:20,windKmh:30,windFromDegrees:270,directNormalWm2:600,diffuseWm2:100,precipitationMm:0})),sources:[],warnings:[]};
const result=simulateLandscape(land,request,'demo-engine-test',()=>{},origin);
assert.match(result.engine,/Ginger/);
assert.equal(result.members.length,9);
assert.equal(result.cellM,25);
assert.equal(result.request,request);
assert.equal(result.buildings[0].structuralIgnitionByMember?.[0],0);
assert.ok(result.buildings.some(b=>b.structuralIgnitionByMember?.[0]===15));
const slower=simulateLandscape(land,demoIgnitionRequest({...request,structural:{maxGapM:20,transferMinutes:30}},...center),'slower-demo',()=>{},origin);
assert.ok(slower.buildings.some(b=>b.structuralIgnitionByMember?.[0]===30),'Real settings affect the real engine output');
const noFuel={...land,buildings:{type:'FeatureCollection' as const,features:[]}};
assert.throws(()=>simulateLandscape(noFuel,request,'no-fake-fallback',()=>{},origin),/No mapped building or vegetation/);
console.log('Demo → production SAGE: validated ignition/settings, nine-member engine, building transfer, changed outcomes, and no synthetic fallback passed.');
