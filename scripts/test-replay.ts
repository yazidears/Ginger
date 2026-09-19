import assert from 'node:assert/strict';
import {demonstrationCase} from '../src/lib/replay/fixture';
import {evaluateBank,runReplay} from '../src/lib/replay/engine';
import {distanceField,scoreForecast,updateWeights} from '../src/lib/replay/metrics';
import {validateReplayCase} from '../src/lib/replay/validation';
import {cellPolygon} from '../src/lib/sage/geometry';
let checks=0;
function test(name:string,fn:()=>void){fn();checks++;console.log('PASS',name);}
test('exact distance field preserves Euclidean diagonal distance',()=>{const d=distanceField([1,0,0,0,0,0,0,0,0],3);assert.equal(d[4],Math.SQRT2);assert.equal(d[8],Math.sqrt(8));assert.ok(distanceField(Array(9).fill(0),3).every(v=>v===Infinity));});
test('perfect, missed, excess and empty forecasts have explicit metrics',()=>{
  const truth=[0,0,0,0,1,0,0,0,0],perfect=scoreForecast(truth,truth,3,25);
  assert.equal(perfect.iou,1);assert.equal(perfect.brier,0);assert.equal(perfect.boundaryMeanM,0);
  const miss=scoreForecast(Array(9).fill(0),truth,3,25);assert.equal(miss.iou,0);assert.equal(miss.missedHa,.0625);assert.equal(miss.boundaryMeanM,null);
  const empty=scoreForecast(Array(9).fill(0),Array(9).fill(0),3,25);assert.equal(empty.iou,null);assert.equal(empty.balancedBrier,null);
  const shifted=scoreForecast([0,0,0,0,0,1,0,0,0],truth,3,25);assert.equal(shifted.boundaryMeanM,25);assert.equal(shifted.extraHa,.0625);
});
test('weights remain finite and normalize after repeated contradictory evidence',()=>{
  const a=[Array(64).fill(0),Array(64).fill(Infinity)];let weights=[.5,.5];
  for(let i=0;i<100;i++)weights=updateWeights(weights,a,Array(64).fill(i%2),20,8,0);
  assert.ok(weights.every(w=>Number.isFinite(w)&&w>0));assert.ok(Math.abs(weights[0]+weights[1]-1)<1e-12);
});
test('replay rejects malformed, future-issued and out-of-domain evidence',()=>{
  const c=demonstrationCase();assert.equal(validateReplayCase(c),c);
  for(const mutate of [
    (x:typeof c)=>{x.landscape.size=500;},
    (x:typeof c)=>{x.request.deadMoisturePct=NaN;},
    (x:typeof c)=>{x.observations[0].availableAt=x.origin;},
    (x:typeof c)=>{x.observations[1].at=x.observations[0].at;},
    (x:typeof c)=>{x.provenance.weatherKind='archived-forecast';x.provenance.weatherIssuedAt=x.observations[0].at;},
    (x:typeof c)=>{x.observations[0].geometry=cellPolygon(9000,0,50,x.landscape.center);},
    (x:typeof c)=>{x.landscape.weather[1].time=x.landscape.weather[0].time;},
    (x:typeof c)=>{x.kind='historical';},
  ]){const copy=structuredClone(c);mutate(copy);assert.throws(()=>validateReplayCase(copy));}
});
const c=demonstrationCase(),total=c.landscape.size**2;
const bank=[Array.from({length:total},(_,i)=>10+i%120),Array.from({length:total},(_,i)=>50+i%120)];
test('target and future observations cannot change their own or earlier forecasts',()=>{
  const before=evaluateBank(c,bank),changed=structuredClone(c);changed.observations[2].geometry=cellPolygon(0,0,50,c.landscape.center);
  const after=evaluateBank(changed,bank);
  for(let i=0;i<=2;i++){assert.deepEqual(before[i].weights,after[i].weights);assert.deepEqual(before[i].updatedProbability,after[i].updatedProbability);}
  assert.deepEqual(before[0].baselineProbability,before[0].updatedProbability);
  assert.ok(before.every((f,t)=>f.assimilated.every(i=>i<t&&Date.parse(c.observations[i].availableAt)<Date.parse(f.at))));
});
test('late arrivals are withheld until available, even when acquired earlier',()=>{
  const delayed=structuredClone(c);delayed.observations[0].availableAt=c.observations[3].at;
  const frames=evaluateBank(delayed,bank);assert.ok(!frames[3].assimilated.includes(0));assert.ok(frames[4].assimilated.includes(0));
});
test('non-arrivals and right-censored cells stay visible',()=>{
  const frames=evaluateBank(c,[Array(total).fill(Infinity)]),last=frames.at(-1)!;
  assert.equal(last.arrival.intervalErrorMinutes,null);assert.ok(last.arrival.noPredictedArrival>0);assert.ok(last.arrival.rightCensoredCells>0);
});
console.log('Running physical integration (27 members)…');
const snapshot=JSON.stringify(c),report=runReplay(c);
test('physical replay preserves input, records provenance and produces finite results',()=>{
  assert.equal(JSON.stringify(c),snapshot);assert.equal(report.members.length,27);assert.equal(report.frames.length,6);assert.match(report.inputSha256,/^[a-f0-9]{64}$/);
  assert.equal(report.kind,'synthetic');assert.ok(report.warnings.some(w=>w.includes('not evidence')));
  for(const f of report.frames){assert.equal(f.observed.length,total);assert.ok(f.updatedProbability.every(p=>Number.isFinite(p)&&p>=0&&p<=1));assert.ok(f.effectiveMembers>=1-1e-8&&f.effectiveMembers<=27+1e-8);assert.ok(Math.abs(f.weights.reduce((s,w)=>s+w,0)-1)<1e-10);}
});
console.log(`${checks} replay checks passed. Example overlap: ${report.summary.baselineMeanIoU?.toFixed(3)} → ${report.summary.updatedMeanIoU?.toFixed(3)} (synthetic only).`);
