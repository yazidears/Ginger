import assert from 'node:assert/strict';
import {NextRequest} from 'next/server';
import {POST} from '../src/app/api/forest/[...path]/route';
async function main(){
const original=globalThis.fetch;let forwarded=0;
globalThis.fetch=async()=>{forwarded++;return Response.json({detail:'Invalid model input'},{status:422});};
try{
 const send=(origin:string,host='127.0.0.1:3051',forwardedHost?:string)=>POST(new NextRequest('http://localhost:3051/api/forest/runs',{method:'POST',headers:{Host:host,Origin:origin,...(forwardedHost?{'X-Forwarded-Host':forwardedHost}:{}),'Content-Type':'application/json'},body:'{}'}),{params:Promise.resolve({path:['runs']})});
 assert.equal((await send('http://127.0.0.1:3051')).status,422);assert.equal(forwarded,1);
 assert.equal((await send('https://attacker.invalid')).status,403);
 assert.equal((await send('http://127.0.0.1:3052')).status,403);
 assert.equal((await send('https://attacker.invalid','127.0.0.1:3051','attacker.invalid')).status,403);assert.equal(forwarded,1);
 console.log('Forest origin: canonical host mismatch accepted, cross-site/port/forwarded-host spoof rejected.');
}finally{globalThis.fetch=original;}

}
void main().catch(error=>{console.error(error);process.exitCode=1;});
