import assert from 'node:assert/strict';
import {NextRequest} from 'next/server';
import {POST,GET} from '../src/app/api/satellite/spread/route';
const url='http://localhost:3018/api/satellite/spread';
const request=(body:unknown,origin='http://localhost:3018')=>new NextRequest(url,{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
const input={latitude:41.73,longitude:1.83,durationHours:6,model:'elmfire',ensembleMembers:1};
async function main(){const previous=global.fetch,token=process.env.DEEPFIRE_TOKEN;process.env.DEEPFIRE_TOKEN='test-only';let posts=0;
 try{global.fetch=async(_url,init)=>{if(init?.method==='POST'){posts++;assert.deepEqual(JSON.parse(String(init.body)),input);}return Response.json({id:'test-run',status:'QUEUED'});};
 assert.equal((await POST(request(input,'https://other.invalid'))).status,403);assert.equal(posts,0);
 assert.equal((await POST(request({...input,durationHours:25}))).status,400);assert.equal(posts,0);
 const created=await POST(request(input));assert.equal(created.status,200);assert.equal((await created.json()).status,'QUEUED');assert.equal(posts,1);
 for(const status of ['QUEUED','NO_SPREAD','FAILED']){global.fetch=async()=>Response.json({id:'test-run',status});const r=await GET(new NextRequest(url+'?id=test-run'));assert.equal((await r.json()).status,status);}
 global.fetch=async()=>Response.json({id:'test-run',status:'COMPLETED',result:{type:'FeatureCollection',features:[]}});assert.equal((await GET(new NextRequest(url+'?id=test-run'))).status,200);
 global.fetch=async()=>Response.json({id:'test-run',status:'COMPLETED',result:{bad:true}});assert.equal((await GET(new NextRequest(url+'?id=test-run'))).status,502);
 assert.equal((await GET(new NextRequest(url+'?id=../../token'))).status,400);
 console.log('PASS simulation same-origin guard, input bounds, one submission, queued/completed/no-spread/failed states and malformed-result rejection');
 }finally{global.fetch=previous;if(token===undefined)delete process.env.DEEPFIRE_TOKEN;else process.env.DEEPFIRE_TOKEN=token;}}
void main();
