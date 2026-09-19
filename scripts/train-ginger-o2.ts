import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {csvRecords,requiredNumber,metrics,meanDayMAE,bootstrapImprovement,type Pair} from '../src/lib/sage/backtest';
import {createBehaviorModel} from '../src/lib/sage/physics';
type Row={id:string;day:string;wind:number;moisture:number;observed:number};
type Fit={coefficients:number[];lambda:number;support:{windKmh:[number,number];moisturePct:[number,number]}};
const sha=(x:string|Buffer)=>createHash('sha256').update(x).digest('hex');
const days=(rows:Row[])=>[...new Set(rows.map(r=>r.day))].sort();
const predict=(f:Fit,r:Row)=>Math.exp(f.coefficients[0]+f.coefficients[1]*Math.log1p(r.wind)+f.coefficients[2]*r.moisture/10);
const supported=(f:Fit,r:Row)=>r.wind>=f.support.windKmh[0]&&r.wind<=f.support.windKmh[1]&&r.moisture>=f.support.moisturePct[0]&&r.moisture<=f.support.moisturePct[1];
function fit(rows:Row[],lambda:number):Fit {
 const counts=new Map(days(rows).map(d=>[d,rows.filter(r=>r.day===d).length]));
 const samples=rows.map(r=>({x:[1,Math.log1p(r.wind),r.moisture/10],y:Math.log(r.observed),w:1/(counts.size*counts.get(r.day)!)}));
 const b=[0,0,0];
 // Convex coordinate descent; every coordinate is solved exactly with sign projection.
 for(let iteration=0;iteration<20000;iteration++) {let change=0;
  for(let j=0;j<3;j++){let numerator=0,denominator=j?lambda:0;
   for(const s of samples){let residual=s.y;for(let k=0;k<3;k++)if(k!==j)residual-=b[k]*s.x[k];numerator+=s.w*s.x[j]*residual;denominator+=s.w*s.x[j]*s.x[j];}
   let next=numerator/denominator;if(j===1)next=Math.max(0,next);if(j===2)next=Math.min(0,next);change=Math.max(change,Math.abs(next-b[j]));b[j]=next;
  }if(change<1e-10)break;if(iteration===19999)throw Error('Fit failed to converge');
 }
 return {coefficients:b,lambda,support:{windKmh:[Math.min(...rows.map(r=>r.wind)),Math.max(...rows.map(r=>r.wind))],moisturePct:[Math.min(...rows.map(r=>r.moisture)),Math.max(...rows.map(r=>r.moisture))]}};
}
async function main(){
 const protocolText=await readFile('data/ginger-o2/protocol.json','utf8'),protocol=JSON.parse(protocolText);
 const source=JSON.parse(await readFile('data/ginger-o1/annaburroo/source.json','utf8'));
 for(const f of source.files)if(sha(await readFile('data/ginger-o1/annaburroo/'+f.file))!==f.sha256)throw Error('Checksum mismatch');
 const plots=csvRecords(await readFile('data/ginger-o1/annaburroo/Plot_Average_Data.csv','utf8'));
 const intervals=csvRecords(await readFile('data/ginger-o1/annaburroo/Burn_Period_Data.csv','utf8'));
 const dates=new Map<string,Set<string>>();for(const r of intervals){const d=dates.get(r.FireID)??new Set<string>();d.add(r['Date.yymmdd']);dates.set(r.FireID,d);}
 const rows:Row[]=[],excluded:unknown[]=[];
 for(const r of plots){const wind=requiredNumber(r['MidFlwind.ms']),moisture=requiredNumber(r['DFMC.%']),ros=requiredNumber(r['ROS.ms']),d=dates.get(r.FireID);
 if(wind===null||wind<0||moisture===null||moisture<=0||ros===null||ros<=0||d?.size!==1){excluded.push({id:r.FireID,reason:'Missing/invalid wind, moisture, observed ROS or unique day'});continue;}
 rows.push({id:r.FireID,day:[...d][0],wind:wind*3.6,moisture,observed:ros*60});}
 if(new Set(rows.map(r=>r.id)).size!==rows.length)throw Error('Duplicate fire');
 const baselineModel=createBehaviorModel(),baseline=(r:Row)=>baselineModel('1',Math.max(1,r.moisture),90,r.wind,270,[0,0]).headMMin;
 const select=(training:Row[])=>{const scores=protocol.ridgeCandidates.map((lambda:number)=>{const pairs:Pair[]=[];for(const d of days(training)){const f=fit(training.filter(r=>r.day!==d),lambda);pairs.push(...training.filter(r=>r.day===d).map(r=>({day:r.day,observed:r.observed,predicted:predict(f,r)})));}return {lambda,dayMAE:meanDayMAE(pairs)};});scores.sort((a:{lambda:number;dayMAE:number},b:{lambda:number;dayMAE:number})=>a.dayMAE-b.dayMAE||b.lambda-a.lambda);return {selected:scores[0].lambda,scores};};
 const folds=days(rows).map(day=>{const training=rows.filter(r=>r.day!==day),selection=select(training),fitted=fit(training,selection.selected);return {day,trainingDays:days(training),innerFolds:days(training).length,selection,fitted,predictions:rows.filter(r=>r.day===day).map(r=>({...r,baseline:baseline(r),candidate:predict(fitted,r),inSupport:supported(fitted,r)}))};});
 const predictions=folds.flatMap(f=>f.predictions),pairs=(kind:'baseline'|'candidate'|'guarded'):Pair[]=>predictions.map(r=>({day:r.day,observed:r.observed,predicted:kind==='guarded'?(r.inSupport?r.candidate:r.baseline):r[kind]}));
 const finalSelection=select(rows),fitted=fit(rows,finalSelection.selected);
 const evaluation={baseline:metrics(pairs('baseline')),candidate:metrics(pairs('candidate')),guarded:metrics(pairs('guarded')),dayMAE:{baseline:meanDayMAE(pairs('baseline')),candidate:meanDayMAE(pairs('candidate')),guarded:meanDayMAE(pairs('guarded'))},candidateBootstrap:bootstrapImprovement(pairs('baseline'),pairs('candidate')),guardedBootstrap:bootstrapImprovement(pairs('baseline'),pairs('guarded')),outsideTrainingSupport:predictions.filter(r=>!r.inSupport).length};
 const artifact={version:'GingerO2-grass-1',status:'experimental Australian grass component',formula:protocol.family,...fitted,source,protocolSha256:sha(protocolText),training:{fires:rows.length,days:days(rows),excluded},evaluation};
 await writeFile('data/ginger-o2/grass-model.json',JSON.stringify(artifact,null,2)+'\n');
 const codeHashes=Object.fromEntries(await Promise.all(['scripts/train-ginger-o2.ts','src/lib/sage/physics.ts','src/lib/sage/backtest.ts','package-lock.json'].map(async f=>[f,sha(await readFile(f))])));
 await writeFile('reports/ginger-o2/grass-training.json',JSON.stringify({protocol,source,codeHashes,inputRows:{plots:plots.length,intervals:intervals.length,eligible:rows.length,excluded},evaluation,folds,finalSelection,artifactSha256:sha(await readFile('data/ginger-o2/grass-model.json'))},null,2)+'\n');
 console.log(JSON.stringify({fitted,evaluation},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
