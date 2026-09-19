import {NextRequest,NextResponse} from 'next/server';
import {spawn} from 'node:child_process';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {parseLabQuery} from '@/lib/satellite-lab';
import {sentinelScene} from '@/lib/providers/sentinel';
import {cached} from '@/lib/providers/http';
export const runtime='nodejs';
let running=false;
export async function GET(req:NextRequest){
 let q;const sceneId=req.nextUrl.searchParams.get('scene')||'',beforeId=req.nextUrl.searchParams.get('before');
 try{q=parseLabQuery(req.nextUrl.searchParams);if(!/^S2[A-C]_T[A-Z0-9]{5}_\d{8}T\d{6}_L2A$/.test(sceneId)||(beforeId&&!/^S2[A-C]_T[A-Z0-9]{5}_\d{8}T\d{6}_L2A$/.test(beforeId)))throw Error();}catch{return NextResponse.json({error:'Select a valid scene and location.'},{status:400});}
 try{const result=await cached(`raster:${sceneId}:${beforeId}:${q.lat}:${q.lon}`,3600000,async()=>{
 if(running)throw Error('Another raster is being processed. Retry shortly.');running=true;
 try{const scene=await sentinelScene(sceneId),before=beforeId?await sentinelScene(beforeId):null;
 if(before&&Date.parse(before.time)>=Date.parse(scene.time))throw Error('The comparison scene must be earlier.');
 if([scene,before].filter(Boolean).some(s=>!['red','nir','swir22','scl'].every(k=>s!.assets[k])))throw Error('This scene lacks calibrated bands or classification.');
 return await new Promise<unknown>((resolve,reject)=>{
 const child=spawn(process.env.GINGER_RASTER_PYTHON||join(homedir(),'.cache/ginger-satellite-python/bin/python'),[join(process.cwd(),'scripts/satellite-raster.py')],{stdio:['pipe','pipe','pipe']});
 let output='',settled=false;const timer=setTimeout(()=>{child.kill('SIGKILL');finish(Error('Raster processing timed out. Try a different scene.'));},90000);
 function finish(error?:Error,value?:unknown){if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);}
 child.stdout.on('data',b=>{output+=b.toString();if(output.length>2000000){child.kill('SIGKILL');finish(Error('Raster output exceeded its limit.'));}});
 child.stderr.resume();child.stdin.on('error',()=>{});
 child.on('error',()=>finish(Error('Raster runtime unavailable. Install requirements-satellite.txt and configure GINGER_RASTER_PYTHON.')));
 child.on('close',code=>{if(code!==0){finish(Error('Raster data could not be read for this location. Try another scene.'));return;}try{finish(undefined,JSON.parse(output));}catch{finish(Error('Invalid raster result.'));}});
 child.stdin.end(JSON.stringify({...q,scene,before}));
 });}finally{running=false;}
 });return NextResponse.json(result);}catch(e){return NextResponse.json({error:(e as Error).message},{status:503});}
}
