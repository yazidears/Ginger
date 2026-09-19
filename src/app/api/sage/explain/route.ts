import {NextResponse} from 'next/server';
import {readRun} from '@/lib/sage/jobs';
import {requestSageCompletion,sageConfiguration} from '@/lib/sage/model-provider';
import {EXPLANATION_INSTRUCTIONS,explanationEvidence} from '@/lib/sage/explanation';
export const runtime='nodejs';
export async function GET(){const config=sageConfiguration();return NextResponse.json({configured:config.configured,provider:config.provider,model:config.model},{headers:{'Cache-Control':'no-store'}});}
export async function POST(request:Request){
  if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)return NextResponse.json({error:'Cross-origin request rejected'},{status:403});
  if(!sageConfiguration().configured)return NextResponse.json({error:'The explanation assistant is not connected yet.'},{status:503});
  try{
    const raw=await request.text();if(raw.length>4000)return NextResponse.json({error:'Question too long'},{status:413});
    const body=JSON.parse(raw);
    if(typeof body.runId!=='string'||!/^[0-9a-f-]{36}$/.test(body.runId)||typeof body.question!=='string'||!body.question.trim()||body.question.length>1500)return NextResponse.json({error:'Choose a completed run and ask a short question.'},{status:400});
    const run=await readRun(body.runId);if(run?.state!=='completed'||!run.result)return NextResponse.json({error:'Completed run unavailable'},{status:404});
    const answer=await requestSageCompletion({instructions:EXPLANATION_INSTRUCTIONS,input:[{role:'user',content:`Run summary:\n${JSON.stringify(explanationEvidence(run.result))}\nQuestion:\n${body.question.trim()}`}],signal:request.signal});
    return NextResponse.json({...answer,runId:run.id},{headers:{'Cache-Control':'no-store'}});
  }catch{return NextResponse.json({error:'Explanation unavailable. Your simulation is unchanged.'},{status:502});}
}
