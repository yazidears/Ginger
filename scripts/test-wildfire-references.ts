import assert from 'node:assert/strict';
import {referencesFor,wildfireReferenceText} from '../src/lib/wildfire-references';
import {GET} from '../src/app/api/firescope/[region]/[z]/[x]/[y]/route';
async function main(){
 assert.deepEqual(referencesFor('risk').map(s=>s.id),['firescope']);
 assert.deepEqual(referencesFor('incidents').map(s=>s.id),['focs','watch-duty']);
 assert.match(wildfireReferenceText(),/not evidence used/);
 const request=new Request('http://localhost/api/firescope');
 const invoke=(region='europe',z='7',x='64',y='80')=>GET(request,{params:Promise.resolve({region,z,x,y})});
 const original=globalThis.fetch;
 try {
  let calls=0;
  globalThis.fetch=async (input)=>{calls++;assert.equal(String(input),'https://tiles.firescope.ai/risk_tiles_webp/7/64/80.webp');return new Response(new Uint8Array([82,73,70,70]),{headers:{'content-type':'image/webp'}});};
  for(const args of [['other','7','64','80'],['europe','13','64','80'],['europe','7','128','80'],['europe','7','64','-1'],['europe','7','../1','80']])assert.equal((await invoke(...args as [string,string,string,string])).status,400);
  assert.equal(calls,0);
  const tile=await invoke();assert.equal(tile.status,200);assert.equal(tile.headers.get('content-type'),'image/webp');assert.equal((await tile.arrayBuffer()).byteLength,4);
  globalThis.fetch=async()=>new Response('missing',{status:404});assert.equal((await invoke()).status,404);
  globalThis.fetch=async()=>new Response('<html>error</html>',{headers:{'content-type':'text/html'}});assert.equal((await invoke()).status,502);
  globalThis.fetch=async()=>{throw new Error('offline');};assert.equal((await invoke()).status,502);
 }finally{globalThis.fetch=original;}
 console.log('Wildfire references and tile route checks passed');
}
void main();
