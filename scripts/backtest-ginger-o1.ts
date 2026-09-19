import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {bootstrapImprovement,csvRecords,fitScale,meanDayMAE,metrics,requiredNumber,type Pair} from '../src/lib/sage/backtest';
import {createBehaviorModel} from '../src/lib/sage/physics';
import {GINGER_O1} from '../src/lib/sage/model';

const root=path.resolve('data/ginger-o1/annaburroo'),out=path.resolve('reports/ginger-o1');
const sha=(data:string|Buffer)=>createHash('sha256').update(data).digest('hex');
type Fire={id:string;day:string;wind:number;moisture:number;observed:number;steadyDerived:number|null;curing:number|null;treatment:string};

async function main(){
  const source=JSON.parse(await readFile(path.join(root,'source.json'),'utf8'));
  for(const f of source.files){if(sha(await readFile(path.join(root,f.file)))!==f.sha256)throw Error(`Source checksum mismatch: ${f.file}`);}
  const plots=csvRecords(await readFile(path.join(root,'Plot_Average_Data.csv'),'utf8'));
  const intervals=csvRecords(await readFile(path.join(root,'Burn_Period_Data.csv'),'utf8'));
  const dates=new Map<string,Set<string>>();
  for(const r of intervals){const days=dates.get(r.FireID)??new Set();days.add(r['Date.yymmdd']);dates.set(r.FireID,days);}
  const fires:Fire[]=[],excluded:{id:string;reason:string}[]=[];
  for(const p of plots){
    const wind=requiredNumber(p['MidFlwind.ms']),moisture=requiredNumber(p['DFMC.%']),ros=requiredNumber(p['ROS.ms']);
    const days=dates.get(p.FireID);
    if(wind===null||wind<0||moisture===null||moisture<=0||ros===null||ros<=0||days?.size!==1){excluded.push({id:p.FireID,reason:'Missing/invalid midflame wind, measured moisture, observed ROS, or unique burn day'});continue;}
    const day=[...days][0];if(!/^86\d{4}$/.test(day))throw Error('Unexpected burn date');
    fires.push({id:p.FireID,day,wind:wind*3.6,moisture,observed:ros*60,steadyDerived:requiredNumber(p['RSS.ms']),curing:requiredNumber(p['Cure.%']),treatment:p.FuelTreat});
  }
  if(new Set(fires.map(f=>f.id)).size!==fires.length)throw Error('Duplicate experimental fire');
  // Freeze the chronological split before fitting. Entire burn days remain together.
  const days=[...new Set(fires.map(f=>f.day))].sort();
  const trainDays=days.slice(0,Math.floor(days.length*.6)),validationDays=days.slice(trainDays.length,Math.floor(days.length*.8)),testDays=days.slice(trainDays.length+validationDays.length);
  if(Math.min(trainDays.length,validationDays.length,testDays.length)<2)throw Error('At least two days per split required');
  const model=createBehaviorModel();
  const predictions=new Map(fires.map(f=>[f.id,model('1',Math.max(1,f.moisture),90,f.wind,270,[0,0]).headMMin]));
  const rows=(selected:string[],scale=1):Pair[]=>fires.filter(f=>selected.includes(f.day)).map(f=>({day:f.day,observed:f.observed,predicted:predictions.get(f.id)!*scale}));
  // One predeclared candidate: bounded multiplicative calibration of the existing grass proxy.
  // No target-derived RSS, flame geometry or measured ROS enters model inputs.
  const scale=fitScale(rows(trainDays));
  const baselineValidation=meanDayMAE(rows(validationDays)),candidateValidation=meanDayMAE(rows(validationDays,scale));
  const selectedScale=candidateValidation<baselineValidation?scale:1;
  const testBaseline=rows(testDays),testCandidate=rows(testDays,selectedScale);
  const folds=days.map(day=>{
    const training=days.filter(d=>d!==day),factor=fitScale(rows(training));
    return {day,trainingDays:training,scale:factor,baseline:metrics(rows([day])),candidate:metrics(rows([day],factor))};
  });
  const crossBaseline:Pair[]=[],crossCandidate:Pair[]=[];
  for(const fold of folds){crossBaseline.push(...rows([fold.day]));crossCandidate.push(...rows([fold.day],fold.scale));}
  const rawRows=fires.map(f=>({...f,split:trainDays.includes(f.day)?'train':validationDays.includes(f.day)?'validation':'test',baselineMMin:predictions.get(f.id)!,candidateMMin:predictions.get(f.id)!*selectedScale}));
  const report={model:GINGER_O1,generatedAt:new Date().toISOString(),kind:'retrospective surface head-spread-rate component benchmark',source,
    protocol:'chronological burn-day train/validation/test split; one training-fitted scale candidate selected on validation; test is not used for candidate fitting or selection. Leave-one-day-out diagnostics are secondary and are not used to revise the candidate.',
    inputRows:{plots:plots.length,intervals:intervals.length,eligibleFires:fires.length,excluded},
    split:{trainDays,validationDays,testDays,fireCounts:{train:rows(trainDays).length,validation:rows(validationDays).length,test:testBaseline.length}},
    assumptions:['Anderson fuel 1 grass proxy, as in the live engine; flat terrain.','Published derived midflame wind is supplied directly in km/h; no additional 10 m wind adjustment.','Measured dead-fuel moisture with the live engine minimum of 1%; live moisture held at 90% (fuel 1 has no live fuel load).','Primary target: observed plot-average ROS × 60, m/min. Derived steady-state RSS is not a target or input.','Fuel load, height, treatment, curing and ignition-line effects are not resolved by the current fixed grass proxy.','These retrospective measured inputs are not archived operational forecasts.','Australian experimental grass fires do not validate Catalan forest, urban ignition, grid perimeters, or building arrivals.'],
    calibration:{trainingScale:scale,search:{min:.1,max:4,step:.01,objective:'equal-burn-day MAE'},validation:{baselineDayMAE:baselineValidation,candidateDayMAE:candidateValidation},selectedScale,promotedToLive:false,reason:'Single-site grass-only calibration remains a research artifact; no geographic transfer validation.'},
    test:{baseline:metrics(testBaseline),candidate:metrics(testCandidate),pairedDayBootstrap:bootstrapImprovement(testBaseline,testCandidate)},
    leaveOneDayOut:{folds,baseline:metrics(crossBaseline),candidate:metrics(crossCandidate),pairedDayBootstrap:bootstrapImprovement(crossBaseline,crossCandidate)},
    byTreatment:[...new Set(fires.map(f=>f.treatment))].sort().map(treatment=>({treatment,baseline:metrics(fires.filter(f=>f.treatment===treatment).map(f=>({day:f.day,observed:f.observed,predicted:predictions.get(f.id)!})))})),
    codeHashes:Object.fromEntries(await Promise.all(['src/lib/sage/physics.ts','src/lib/sage/backtest.ts','scripts/backtest-ginger-o1.ts','package-lock.json'].map(async f=>[f,sha(await readFile(f))]))),rows:rawRows};
  await mkdir(out,{recursive:true});await writeFile(path.join(out,'field-backtest.json'),JSON.stringify(report,null,2)+'\n');
  const m=report.test,c=report.leaveOneDayOut,fmt=(n:number)=>n.toFixed(2);
  const markdown=`# GingerO1 field benchmark\n\nExperimental research result. No operational accuracy claim.\n\nSource: [CSIRO Annaburroo v3](${source.collection}), ${source.license}. ${source.attribution}\n\n${fires.length} eligible fires on ${days.length} burn days; ${excluded.length} excluded. ${intervals.length} interval records are used only to join dates, not counted as independent backtests.\n\n| Evaluation (m/min) | Existing grass model MAE | Validation-selected model MAE |\n|---|---:|---:|\n| Chronological held-out (${m.baseline.n} fires, ${testDays.length} days) | ${fmt(m.baseline.mae)} | ${fmt(m.candidate.mae)} |\n| Leave-one-day-out (${c.baseline.n} fires, ${days.length} folds) | ${fmt(c.baseline.mae)} | ${fmt(c.candidate.mae)} |\n\nTraining-fitted scale: ${scale}; validation ${selectedScale===1?'rejected the calibration and retained the baseline':'selected the calibration'}. Selected scale: ${selectedScale}; fitted on training days only and selected on validation. **Not applied to live simulations.** Test baseline bias: ${fmt(m.baseline.bias)} m/min; candidate bias: ${fmt(m.candidate.bias)} m/min. Positive bias means overprediction.\n\nPaired day-bootstrap 95% MAE-reduction interval: ${m.pairedDayBootstrap?`${fmt(m.pairedDayBootstrap.lower)} to ${fmt(m.pairedDayBootstrap.upper)} m/min (${m.pairedDayBootstrap.clusters} days; very limited independent sample)`:'unavailable'}.\n\n## Boundaries\n\n${report.assumptions.map(a=>'- '+a).join('\n')}\n\nFull splits, excluded IDs, per-fire predictions, candidate selection, cross-validation folds, checksums and metrics: [field-backtest.json](field-backtest.json). Reproduce with \`npm run backtest:ginger-o1\`.\n`;
  await writeFile(path.join(out,'FIELD-BACKTEST.md'),markdown);
  console.log(JSON.stringify({eligible:fires.length,excluded,split:report.split,calibration:report.calibration,test:report.test,crossValidation:{folds:folds.length,baseline:c.baseline,candidate:c.candidate}},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
