import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

async function main(){
  delete process.env.GINGER_PUBLIC_DEMO;
  const root=await mkdtemp(path.join(tmpdir(),'ginger-ash-test-'));
  process.env.ASH_ROOM_DIR=path.join(root,'rooms');process.env.SAGE_RUN_DIR=path.join(root,'runs');process.env.GINGER_ASH_ROOM_TOKEN='test-only-operator-secret-never-used-in-production';
  try{
    const [{POST:create,GET:status},{POST:act,GET:read},{changeRoom},{createAshRealtimeSecret}]=await Promise.all([import('../src/app/api/ash/rooms/route'),import('../src/app/api/ash/rooms/[id]/route'),import('../src/lib/ash-room-store'),import('../src/lib/ash-realtime')]);
    const id=randomUUID(),origin='http://localhost:3050';
    const request={lat:41.5,lon:2.0,horizonMinutes:120,ignitionRadiusM:50,deadMoisturePct:7,liveMoisturePct:90,windAdjustment:.35,mode:'scenario',confirmation:'',solarDrying:true};
    const result={id,scenario:{name:'Pallejà · hypothetical ignition',assessment:{name:'Pallejà · forest'}},engine:'test-fixture-only',generatedAt:'2026-09-18T12:00:00Z',forecastOrigin:'2026-09-18T12:00:00Z',request,runtimeMs:1,size:1,cellM:25,center:[2,41.5],sources:[],warnings:['Synthetic test fixture.'],assumptions:['Not a real operational forecast.'],members:[],buildings:[],footprints:{type:'FeatureCollection',features:[]},cells:{type:'FeatureCollection',features:[]},domain:{type:'FeatureCollection',features:[]},sun:{altitudeDegrees:0,azimuthDegrees:0},weather:[],stats:{buildingCount:0,knownHeights:0,reached:0,burnedHa:0,fuelCoveragePct:0,boundaryReached:false}};
    await mkdir(process.env.SAGE_RUN_DIR,{recursive:true});await writeFile(path.join(process.env.SAGE_RUN_DIR,`${id}.json`),JSON.stringify({id,state:'completed',stage:'Test fixture',createdAt:result.generatedAt,updatedAt:result.generatedAt,request,result}));
    const post=(url:string,body:unknown,token?:string)=>new Request(origin+url,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
    assert.equal((await status()).status,200);
    assert.equal((await create(new Request(origin+'/api/ash/rooms',{method:'POST',headers:{Origin:'http://127.0.0.1:3050',Host:'127.0.0.1:3050','Content-Type':'application/json'},body:JSON.stringify({action:'catalog',accessToken:'wrong'})}))).status,401);
    assert.equal((await create(new Request(origin+'/api/ash/rooms',{method:'POST',headers:{Origin:'https://attacker.invalid',Host:'127.0.0.1:3050','Content-Type':'application/json'},body:JSON.stringify({action:'catalog',accessToken:'wrong'})}))).status,403);
    assert.equal((await create(post('/api/ash/rooms',{action:'create',accessToken:'wrong',name:'A',runId:id}))).status,401);
    const created=await create(post('/api/ash/rooms',{action:'create',accessToken:process.env.GINGER_ASH_ROOM_TOKEN,name:'Operator A',runId:id,minute:30}));assert.equal(created.status,201);assert.match(created.headers.get('set-cookie')||'',/HttpOnly/);
    const a=await created.json();const roomId=a.room.id,ctx={params:Promise.resolve({id:roomId})},url=`/api/ash/rooms/${roomId}`;
    const joined=await create(post('/api/ash/rooms',{action:'join',accessToken:process.env.GINGER_ASH_ROOM_TOKEN,name:'Operator B',roomId}));assert.equal(joined.status,201);const b=await joined.json();assert.notEqual(a.room.memberId,b.room.memberId);
    assert.equal((await read(new Request(origin+url),ctx)).status,401);
    const [floorA,floorB]=await Promise.all([act(post(url,{action:'claim-floor'},a.memberToken),ctx),act(post(url,{action:'claim-floor'},b.memberToken),ctx)]);assert.deepEqual([floorA.status,floorB.status].sort(),[200,409]);
    const host=floorA.status===200?a:b,listener=floorA.status===200?b:a;
    assert.equal((await act(post(url,{action:'signal',to:host.room.memberId,description:{type:'offer',sdp:'synthetic-offer-test-only'}},listener.memberToken),ctx)).status,200);
    const state=await (await read(new Request(origin+url,{headers:{Authorization:`Bearer ${host.memberToken}`}}),ctx)).json();assert.equal(state.signals.length,1);assert.equal(state.signals[0].from,listener.room.memberId);
    const call={action:'tool',name:'incident_status',args:{},callId:'fixture-call-1'};
    const tool=await act(post(url,call,host.memberToken),ctx);assert.equal(tool.status,200);const evidence=await tool.json();assert.equal(evidence.result.runId,id);assert.equal(evidence.result.minute,30);assert.equal(evidence.result.forecast.basis,'hypothetical');assert.equal(evidence.result.placeName,'Pallejà · forest');assert.equal(evidence.result.forecast.name,'Pallejà · forest');assert.equal(evidence.result.forecast.statsTimeMinutes,120);assert.notEqual(evidence.result.forecast.statsTimeMinutes,evidence.result.minute);assert.match(evidence.result.forecast.statsMeaning,/End-of-horizon/);
    const repeated=await (await act(post(url,call,host.memberToken),ctx)).json();assert.deepEqual(repeated,evidence);
    const shared=await (await read(new Request(origin+url,{headers:{Authorization:`Bearer ${listener.memberToken}`}}),ctx)).json();assert.equal(shared.events.filter((e:{kind:string})=>e.kind==='tool').length,1);assert.equal(shared.events.at(-1).runId,id);
    assert.equal((await act(post(url,{action:'tool',name:'incident_status',args:{},callId:'wrong-floor'},listener.memberToken),ctx)).status,409);
    const proposed=await (await act(post(url,{action:'ask',question:'Record an unverified test field report',callId:'test-proposal'},listener.memberToken),ctx)).json();assert.equal(proposed.result.authorizationRequired,true);assert.equal(proposed.result.proposal.status,'pending');
    const proposalId=proposed.result.proposal.id;
    assert.equal((await act(post(url,{action:'confirm',proposalId,decision:'approve',authorized:true},listener.memberToken),ctx)).status,403);
    const reject={action:'confirm',proposalId,decision:'reject',confirmation:`reject:${proposalId}`};const rejected=await Promise.all([act(post(url,reject,a.memberToken),ctx),act(post(url,reject,b.memberToken),ctx)]);assert.deepEqual(rejected.map(r=>r.status).sort(),[200,409]);
    assert.equal((await act(post(url,{action:'tool',name:'evacuate',args:{},callId:'no-authority'},host.memberToken),ctx)).status,403);
    await act(post(url,{action:'release-floor'},host.memberToken),ctx);assert.equal((await act(post(url,{action:'claim-floor'},listener.memberToken),ctx)).status,200);
    await changeRoom(roomId,room=>{room.floor!.expiresAt=Date.now()-1;});assert.equal((await act(post(url,{action:'claim-floor'},host.memberToken),ctx)).status,200);
    const snapshot=await changeRoom(roomId,room=>structuredClone(room));process.env.OPENAI_API_KEY='test-server-only-key';let captured:Record<string,unknown>|undefined;
    const credential=await createAshRealtimeSecret(snapshot,host.room.memberId,async(_url,init)=>{captured=JSON.parse(String(init?.body));return Response.json({value:'test-ephemeral-client-secret',expires_at:123});});
    assert.equal(credential.value,'test-ephemeral-client-secret');assert.equal(JSON.stringify(credential).includes('test-server-only-key'),false);const session=captured?.session as {type:string;model:string;tools:unknown[];audio:{input:{turn_detection:{interrupt_response:boolean}}}};assert.equal(session.type,'realtime');assert.equal(session.model,process.env.ASH_REALTIME_MODEL||'gpt-realtime-2.1');assert.equal(session.tools.length,6);assert.equal(session.audio.input.turn_detection.interrupt_response,true);
    process.env.GINGER_PUBLIC_DEMO='1';
    assert.equal((await (await status()).json()).publicDemo,true);
    assert.equal((await create(post('/api/ash/rooms',{action:'catalog'}))).status,200);
    const guest=await create(post('/api/ash/rooms',{action:'create',name:'Demo guest',runId:id}));assert.equal(guest.status,201);
    const guestRoom=await guest.json();assert.equal((await read(new Request(origin+`/api/ash/rooms/${guestRoom.room.id}`),{params:Promise.resolve({id:guestRoom.room.id})})).status,401);
    assert.equal((await create(new Request(origin+'/api/ash/rooms',{method:'POST',headers:{Origin:'https://attacker.invalid','Content-Type':'application/json'},body:JSON.stringify({action:'catalog'})}))).status,403);
    delete process.env.GINGER_PUBLIC_DEMO;
    assert.equal((await create(post('/api/ash/rooms',{action:'catalog'}))).status,401);
    console.log('PASS Ash: two authenticated clients; shared run/time/events; exclusive floor and expiry; signaling isolation; replay-safe tools; explicit proposal approval; no emergency tool; ephemeral Realtime contract. Synthetic fixture only; no live operations writes or provider calls.');
  }finally{await rm(root,{recursive:true,force:true});}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
