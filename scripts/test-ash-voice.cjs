const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict');
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const {voiceConfig,authorizeVoice,wavSampleRate,transcribeAudio,synthesizeSpeech,boundedBytes,voiceRequest}=require('../src/lib/ash-voice.ts');
const {validateFix,buildSituation}=require('../src/lib/ash-situation.ts');
const previous={...process.env};
function wav(){const b=Buffer.alloc(44+32000);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);return b;}
(async()=>{
 delete process.env.SLNG_API_KEY;delete process.env.ASH_ACCESS_TOKEN;
 assert.throws(()=>voiceConfig(),/Configure/);
 process.env.SLNG_API_KEY='fixture-vendor-key';process.env.ASH_ACCESS_TOKEN='fixture-app-token-'.repeat(3);process.env.SLNG_BASE_URL='https://us-east.api.slng.ai';
 const config=voiceConfig();
 assert.throws(()=>authorizeVoice(new Request('http://local')),/token/);
 authorizeVoice(new Request('http://local',{headers:{Authorization:'Bearer '+config.token}}));
 process.env.SLNG_BASE_URL='https://attacker.example';assert.throws(()=>voiceConfig(),/gateway/);process.env.SLNG_BASE_URL=config.base;
 assert.equal(wavSampleRate(wav()),16000);assert.throws(()=>wavSampleRate(Buffer.from('invalid')),/WAV/);
 const bad=wav();bad.writeUInt16LE(2,22);assert.throws(()=>wavSampleRate(bad),/mono/);
 const transcript=await transcribeAudio(wav(),config,async(url,options)=>{
   assert.equal(url,'https://us-east.api.slng.ai/v1/stt/slng/deepgram/nova:3-en');assert.equal(options.headers.Authorization,'Bearer fixture-vendor-key');assert.equal(options.body.get('channels'),'1');assert.equal(options.body.get('sample_rate'),'16000');assert.equal(options.body.get('audio').type,'audio/wav');
   return Response.json({results:{channels:[{alternatives:[{transcript:'Ash, what is nearby?'}]}]}});
 });assert.equal(transcript,'Ash, what is nearby?');
 await assert.rejects(()=>transcribeAudio(wav(),config,async()=>new Response('secret diagnostic',{status:401})),/SLNG request failed \(401\)/);
 await assert.rejects(()=>transcribeAudio(wav(),config,async()=>Response.json({results:{}})),/invalid transcript/);
 const speech=await synthesizeSpeech('Current briefing',config,async(url,options)=>{assert.match(url,/aura:2-en$/);const body=JSON.parse(options.body);assert.equal(body.encoding,'linear16');assert.equal(body.container,'wav');return new Response(wav());});assert.equal(speech.length,wav().length);
 await assert.rejects(()=>synthesizeSpeech('Briefing',config,async()=>Response.json({error:'fake success'})),/invalid speech audio/);
 await assert.rejects(()=>boundedBytes(new Response('123456').body,5),/size limit/);
 let called=false;const unauthorized=await voiceRequest(new Request('http://local'),async()=>{called=true;return new Response();});assert.equal(unauthorized.status,401);assert.equal(called,false);
 const now=Date.now(),fix={lat:41.3,lon:1.86,accuracyM:7,observedAt:new Date(now).toISOString(),source:'ios-core-location'};
 assert.equal(validateFix(fix,41.3,1.86,now).accuracyM,7);
 for(const invalid of [{...fix,observedAt:new Date(now-61000).toISOString()},{...fix,accuracyM:1001},{...fix,source:'dgps'},{...fix,lat:42}])assert.throws(()=>validateFix(invalid,41.3,1.86,now));
 const op=(id,lat,time)=>({id,text:'Unverified report',createdAt:new Date(time).toISOString(),location:{lat,lon:1.86},verification:'unverified'});
 const situation=buildSituation({location:{lat:41.3,lon:1.86}},{observations:[op('near',41.301,now-1000),op('far',45,now),op('old',41.3,now-90000000)],tasks:[]},now);
 assert.deepEqual(situation.observations.map(x=>x.id),['near']);assert.equal(situation.dgps.available,false);assert.equal(situation.observations[0].verification,'unverified');assert.equal(buildSituation({location:fix},null).operationsAvailable,false);
 console.log('PASS SLNG contracts, authentication, payload bounds, provider errors, GPS freshness and nearby filtering');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{for(const key of ['SLNG_API_KEY','ASH_ACCESS_TOKEN','SLNG_BASE_URL']){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}});
