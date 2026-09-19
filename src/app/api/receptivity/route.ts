import {readReceptivity} from '@/lib/receptivity/engine';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request){const result=await readReceptivity();const etag=result.snapshot?`"${result.snapshot.generatedAt}:${result.stale}:${result.error||""}"`:null;if(etag&&request.headers.get("if-none-match")===etag)return new Response(null,{status:304,headers:{ETag:etag,"Cache-Control":"no-store"}});return Response.json(result,{status:result.snapshot?200:202,headers:{...(etag?{ETag:etag}:{}),'Cache-Control':'no-store','Retry-After':result.snapshot?'60':'8'}});}
