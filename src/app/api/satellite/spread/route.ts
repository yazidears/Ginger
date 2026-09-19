import {NextRequest,NextResponse} from 'next/server';
import {DeepfireProvider,deepfireConfigured,polygonCollection} from '@/lib/providers/deepfire';
import {parseSpreadInput} from '@/lib/satellite-lab';
export const runtime='nodejs';
// Per-process admission guard; upstream also enforces its two-job limit.
let submitting=false;
function response(value:unknown){
 const r=value as {id?:string;status?:string;result?:unknown};
 if(!r||typeof r.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(r.id)||!['QUEUED','COMPLETED','NO_SPREAD','FAILED'].includes(r.status||''))throw Error('Invalid spread response');
 if(r.status==='COMPLETED')polygonCollection(r.result);
 return NextResponse.json(value,{headers:{'Cache-Control':'no-store','Retry-After':'10'}});
}
export async function POST(req:NextRequest){
 if(req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Open the simulator from Ginger.'},{status:403});
 if(!deepfireConfigured())return NextResponse.json({error:'Deepfire is not configured.'},{status:503});
 let input;try{if(Number(req.headers.get('content-length'))>4096)throw Error();input=parseSpreadInput(await req.json());}catch{return NextResponse.json({error:'Invalid simulation settings.'},{status:400});}
 if(submitting)return NextResponse.json({error:'A simulation submission is already in progress.'},{status:429});
 submitting=true;
 try{return response(await new DeepfireProvider().createSpread(input));}
 catch{return NextResponse.json({error:'Submission was not confirmed. Check simulations in Deepfire before trying again; a job may have been accepted.'},{status:502});}
 finally{submitting=false;}
}
export async function GET(req:NextRequest){
 const id=req.nextUrl.searchParams.get('id')||'';
 if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))return NextResponse.json({error:'Invalid simulation id.'},{status:400});
 try{return response(await new DeepfireProvider().readSpread(id));}catch{return NextResponse.json({error:'Could not retrieve this simulation. Retry the status check.'},{status:502});}
}
