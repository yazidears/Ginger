import {NextRequest} from 'next/server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const GET_PATHS=/^(status|trees|tiles|weather|runs\/[a-f0-9]{32}|jobs\/[a-f0-9]{32})$/;
async function proxy(request:NextRequest,context:{params:Promise<{path:string[]}>}){
 const route=(await context.params).path.join('/');
 if(request.method==='GET'?!GET_PATHS.test(route):!['process','runs'].includes(route))return Response.json({error:'Unknown forest endpoint'},{status:404});
 // Next may canonicalise request.url to localhost; validate against the actual HTTP Host.
 const expectedOrigin=`${request.nextUrl.protocol}//${request.headers.get('host')||request.nextUrl.host}`;
 if(request.method==='POST'&&request.headers.get('origin')&&request.headers.get('origin')!==expectedOrigin)return Response.json({error:'Origin mismatch'},{status:403});
 const base=process.env.GINGER_FOREST_SERVICE||'http://127.0.0.1:8788';
 try{
  const body=request.method==='POST'?await request.text():undefined;
  if(body&&body.length>16384)return Response.json({error:'Request too large'},{status:413});
  const response=await fetch(`${base}/${route}${request.nextUrl.search}`,{method:request.method,headers:{'Content-Type':'application/json'},body,cache:'no-store',signal:AbortSignal.timeout(30000)});
  return new Response(response.body,{status:response.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Forest processing service is unavailable. Regional ICGC layers remain available; no synthetic trees are substituted.'},{status:503});}
}
export const GET=proxy;
export const POST=proxy;
