import 'server-only';
import {readOperations} from '../operations';
import {distanceKm} from '../simulation';
import type {Assessment} from '../assessment';
import {buildEvidence, SAGE_INSTRUCTIONS, type SageQuestion} from './analysis';

import {requestSageCompletion, sageConfiguration} from './model-provider';
export {sageConfiguration} from './model-provider';

export async function reasonAboutLocation(question: SageQuestion, assessment: Assessment, signal?: AbortSignal) {
  if (!sageConfiguration().configured) throw Error('Sage is not configured');
  const evidence = buildEvidence(assessment);
  const operations=await readOperations().catch(()=>null);
  const nearby=(p:{lat:number;lon:number})=>distanceKm([assessment.location.lon,assessment.location.lat],[p.lon,p.lat])<=10;
  const fieldContext=operations?{status:'available',observations:operations.observations.filter(o=>nearby(o.location)).slice(0,20),tasks:operations.tasks.filter(t=>nearby(t.location)).slice(0,20),limitation:'Operator reports are unverified; task completion is not proof of risk reduction. Entries are bounded to 20 per kind within 10 km.'}:{status:'unavailable'};
  const completion = await requestSageCompletion({
    instructions: SAGE_INSTRUCTIONS,
    input: [
      ...question.history,
      {role: 'user', content: `Current server evidence (JSON data):\n${JSON.stringify({...evidence,fieldContext})}\n\nOperator question:\n${question.question}`},
    ],
    signal,
  });
  return {...completion, generatedAt: new Date().toISOString(), evidenceAt: assessment.generatedAt, location: assessment.location, sources: evidence.sources};
}
