import assert from 'node:assert/strict';
import {hourlyFFMC,moistureFromFFMC,initialSpreadIndex,receptivityScore} from '../../src/lib/receptivity/model';
import {parseXema,type XemaRow} from '../../src/lib/receptivity/providers';
import {assimilate} from '../../src/lib/receptivity/engine';
import type {Weather} from '../../src/lib/receptivity/types';
const dry={temperature:30,relativeHumidity:20,windSpeed:20,precipitation:0,stepHours:1};
const wet={...dry,precipitation:15,relativeHumidity:95};
assert(hourlyFFMC(85,dry)>85);assert(hourlyFFMC(85,wet)<85);
assert(moistureFromFFMC(hourlyFFMC(85,wet))>moistureFromFFMC(hourlyFFMC(85,dry)));
assert(initialSpreadIndex(90,30)>initialSpreadIndex(90,10));
for(const rh of [0,20,60,100])for(const rain of [0,.1,10,100])for(const previous of [0,50,85,101]){const v=hourlyFFMC(previous,{...dry,relativeHumidity:rh,precipitation:rain});assert(Number.isFinite(v)&&v>=0&&v<=101);}
assert.throws(()=>hourlyFFMC(85,{...dry,relativeHumidity:101}));assert.throws(()=>hourlyFFMC(85,{...dry,stepHours:2}));assert.throws(()=>hourlyFFMC(85,{...dry,precipitation:NaN}));
assert.equal(receptivityScore(60),0);assert.equal(receptivityScore(100),100);
// Distinguish hot conditions after recent rain from hot conditions after a dry spell.
let rainy=85,drought=85;for(let h=0;h<72;h++){drought=hourlyFFMC(drought,dry);rainy=hourlyFFMC(rainy,{...dry,precipitation:h>=68?3:0});}assert(receptivityScore(drought)>receptivityScore(rainy)+20);
// Observation accumulation labels are interval starts, never future data.
const now=Date.parse('2026-09-19T16:00:00Z'),rows:XemaRow[]=[];
for(let i=0;i<48;i++){const time=new Date(now-(48-i)*1800000).toISOString().replace('Z','');for(const [variable,value] of [['30','3'],['32','25'],['33','40'],['35','0.5']])rows.push({id:`${i}/${variable}`,codi_variable:variable,data_lectura:time,valor_lectura:value,codi_base:'SH'});}
const parsed=parseXema(rows,now);assert.equal(parsed.weather.at(-1)?.time,new Date(now).toISOString());assert.equal(parsed.history.rain24h,24);assert.equal(parsed.history.rain1h,1);assert.equal(parsed.history.rain7d,undefined);assert.equal(parsed.history.continuousHours,24);
const missing=parseXema(rows.filter(r=>r.id!=='20/35'),now);assert.equal(missing.history.rain24h,undefined);
const future=parseXema([...rows,{id:'future',codi_variable:'35',data_lectura:'2026-09-19T16:00:00',valor_lectura:'100',codi_base:'SH'}],now);assert.equal(future.history.rain24h,24);
const nullValue=parseXema(rows.map(r=>r.id==='47/35'?{...r,valor_lectura:undefined}:r),now);assert.equal(nullValue.weather.length,47);
const station={id:'TEST',name:'Test fixture',center:[2.1,41.4] as [number,number],elevation:200};
const weather:Weather[]=Array.from({length:144},(_,i)=>({...dry,time:new Date(now-(143-i)*1800000-1800000).toISOString(),stepHours:.5,source:'test fixture'}));
const forecast={weather:Array.from({length:25},(_,i)=>({...dry,time:new Date(now+(i+1)*3600000).toISOString(),source:'test fixture'})),source:'test fixture',issuedAt:new Date(now).toISOString(),detail:'test'};
const result=assimilate(station,weather,{continuousHours:72},forecast,now)!;assert(result);assert.deepEqual(result.frames.map(f=>f.horizon),[0,1,3,6,12,24]);assert.equal(result.frames[1].timestamp,new Date(now+3600000).toISOString());
assert.equal(assimilate(station,weather,{continuousHours:72},forecast,now+2*3600000),null);
assert.equal(assimilate(station,weather.slice(-20),{continuousHours:10},forecast,now),null);
const noForecast=assimilate(station,weather,{continuousHours:72},null,now)!;assert.equal(noForecast.frames.length,1);
console.log('PASS: FFMC wet/dry response, physical bounds, ISI wind response, rain-history contrast, complete rain windows, UTC interval alignment, missing values, stale suppression, spin-up, and six forecast horizons.');
