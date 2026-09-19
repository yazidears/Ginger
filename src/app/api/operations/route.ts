import {mutateOperations,OperationsInputError,readOperations} from '@/lib/operations';
export const runtime='nodejs';
export async function GET(){try{return Response.json(await readOperations(),{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'Operations storage unavailable. Existing records have not been replaced.'},{status:503});}}
export async function POST(request:Request){
 const origin=request.headers.get('origin');if(!origin||origin!==new URL(request.url).origin)return Response.json({error:'Same-origin request required.'},{status:403});
 if(!request.headers.get('content-type')?.includes('application/json'))return Response.json({error:'JSON required.'},{status:415});
 try{const body=await request.text();if(body.length>10000)return Response.json({error:'Request too large.'},{status:413});let input:unknown;try{input=JSON.parse(body);}catch{return Response.json({error:'Invalid JSON.'},{status:400});}return Response.json(await mutateOperations(input),{headers:{'Cache-Control':'no-store'}});}catch(error){return Response.json({error:error instanceof OperationsInputError?error.message:'Could not save operation. Please retry.'},{status:error instanceof OperationsInputError?400:503});}
}
