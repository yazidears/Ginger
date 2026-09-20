import 'server-only';
import {createHash, createHmac, randomUUID, timingSafeEqual} from 'node:crypto';
import {mkdir, readFile, readdir, rename, rm, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {AshRoom, RoomView} from './ash-room-types';
import type {OperationalEvent} from './product-contracts';

export class AshRoomError extends Error {constructor(message:string, public status=400){super(message);}}
export const roomDirectory=()=>path.resolve(process.env.ASH_ROOM_DIR||path.join(process.cwd(),'.ginger-data','ash-rooms'));
const idPattern=/^[a-f0-9-]{36}$/;
export function roomSecret(){const value=(process.env.GINGER_ASH_ROOM_TOKEN||process.env.ASH_ACCESS_TOKEN||'').trim();if(value.length<32)throw new AshRoomError('An operator access token must be configured on the server.',503);return value;}
export function safeEqual(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
export const publicDemo=()=>process.env.GINGER_PUBLIC_DEMO==='1';
export function authorizeBootstrap(token:unknown){const secret=roomSecret();if(publicDemo())return;if(typeof token!=='string'||!safeEqual(token,secret))throw new AshRoomError('Operator access token not recognised.',401);}
export function assertSameOrigin(request:Request){
  // Next dev may canonicalise request.url to localhost even when the browser uses 127.0.0.1.
  // Host is the actual HTTP target; unlike forwarded headers it is not trusted as an alternate origin.
  const target=new URL(request.url),host=request.headers.get('host')||target.host;
  const origin=request.headers.get('origin');if(origin!==`${target.protocol}//${host}`)throw new AshRoomError('Use the Ash application to make this request.',403);
}
export function memberToken(roomId:string,memberId:string){const payload=Buffer.from(JSON.stringify({roomId,memberId,exp:Date.now()+12*3600000})).toString('base64url');return `${payload}.${createHmac('sha256',roomSecret()).update(payload).digest('base64url')}`;}
export function authorizeMember(request:Request,roomId:string){
  const cookie=request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(`ash_${roomId}=`))?.split('=').slice(1).join('=');
  const token=request.headers.get('authorization')?.replace(/^Bearer /,'')||cookie||'';
  const [payload,signature]=token.split('.');
  if(!payload||!signature||!safeEqual(signature,createHmac('sha256',roomSecret()).update(payload).digest('base64url')))throw new AshRoomError('Join this room with your operator access token.',401);
  try {const data=JSON.parse(Buffer.from(payload,'base64url').toString());if(data.roomId!==roomId||!idPattern.test(data.memberId)||!Number.isFinite(data.exp)||data.exp<Date.now())throw Error();return data.memberId as string;}catch{throw new AshRoomError('Room membership expired. Join again.',401);}
}
export function roomCookie(request:Request,id:string,token:string){return `ash_${id}=${token}; HttpOnly; SameSite=Strict; Path=/api/ash/rooms; Max-Age=43200${new URL(request.url).protocol==='https:'?'; Secure':''}`;}
export function safetyId(memberId:string){return createHash('sha256').update(memberId).digest('hex');}
export function boundedText(value:unknown,max:number,label='Text'){if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw new AshRoomError(`${label} must contain 1–${max} characters.`);return value.trim();}
export async function roomBody(request:Request){
  if(!request.headers.get('content-type')?.includes('application/json'))throw new AshRoomError('JSON request required.');
  const reader=request.body?.getReader();if(!reader)throw new AshRoomError('Request body required.');let size=0;const parts:Uint8Array[]=[];
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>48000){await reader.cancel();throw new AshRoomError('Request too large.',413);}parts.push(value);}
  try{const data=JSON.parse(Buffer.concat(parts).toString());if(!data||typeof data!=='object'||Array.isArray(data))throw Error();return data as Record<string,unknown>;}catch{throw new AshRoomError('Invalid JSON.');}
}
export function appendRoomEvent(room:AshRoom,actor:string,kind:OperationalEvent['kind'],summary:string,verification:OperationalEvent['verification']='system'){
  const event:OperationalEvent={id:randomUUID(),roomId:room.id,at:new Date().toISOString(),actor,kind,summary:summary.slice(0,500),runId:room.runId,scenarioId:room.scenarioId,minute:room.minute,verification};
  room.events.push(event);room.events=room.events.slice(-200);return event;
}
export function requireRoomMember(room:AshRoom,id:string){const member=room.members.find(m=>m.id===id);if(!member)throw new AshRoomError('Room membership unavailable. Join again.',401);return member;}
export function requireFloor(room:AshRoom,id:string){requireRoomMember(room,id);if(room.floor?.memberId!==id||room.floor.expiresAt<Date.now())throw new AshRoomError('Another participant has the microphone. Request the floor first.',409);}
export function roomView(room:AshRoom,memberId:string,afterSignal=0):RoomView{
  requireRoomMember(room,memberId);const {calls:_,signals,...view}=room;void _;
  let iceServers:RTCIceServer[]=[];try{const values=JSON.parse(process.env.ASH_ICE_SERVERS||'[]');if(Array.isArray(values))iceServers=values.filter(v=>v&&typeof v==='object'&&(typeof v.urls==='string'&&v.urls.length>0||Array.isArray(v.urls)&&v.urls.length>0)&&(typeof v.urls==='string'?[v.urls]:v.urls).every((url:unknown)=>typeof url==='string'&&/^(stun|turn|turns):/.test(url))).slice(0,4).map(v=>({urls:v.urls,...(typeof v.username==='string'?{username:v.username}:{}),...(typeof v.credential==='string'?{credential:v.credential}:{})}));}catch{/* Same-network audio remains usable without a configured relay. */}
  return {...view,floor:room.floor&&room.floor.expiresAt>Date.now()?room.floor:null,memberId,signals:signals.filter(s=>s.to===memberId&&s.sequence>afterSignal&&s.at>Date.now()-60000),voiceConfigured:Boolean(process.env.OPENAI_API_KEY),iceServers,audioNetwork:iceServers.some(s=>(Array.isArray(s.urls)?s.urls:[s.urls]).some(url=>/^turns?:/.test(url)))?'relay-configured':'same-network'};
}
async function readRoomFile(id:string){if(!idPattern.test(id))throw new AshRoomError('Room not found.',404);try{return JSON.parse(await readFile(path.join(roomDirectory(),`${id}.json`),'utf8')) as AshRoom;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')throw new AshRoomError('Room not found.',404);throw e;}}
/** Called while holding changeRoom's lock, before an authorised external mutation. */
export async function checkpointRoom(room:AshRoom){if(!idPattern.test(room.id))throw new AshRoomError('Invalid room.');const root=roomDirectory(),temp=path.join(root,`${room.id}.${randomUUID()}.tmp`);await writeFile(temp,JSON.stringify(room),{mode:0o600});await rename(temp,path.join(root,`${room.id}.json`));}
/** File lock covers multiple Next workers; atomic rename keeps readers from partial JSON. */
export async function changeRoom<T>(id:string,action:(room:AshRoom)=>T|Promise<T>):Promise<T>{
  if(!idPattern.test(id))throw new AshRoomError('Room not found.',404);const root=roomDirectory();await mkdir(root,{recursive:true,mode:0o700});const lock=path.join(root,`${id}.lock`);let acquired=false;
  for(let i=0;i<50;i++){try{await mkdir(lock);acquired=true;break;}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;const age=await stat(lock).then(s=>Date.now()-s.mtimeMs).catch(()=>0);if(age>30000)await rm(lock,{recursive:true,force:true});await new Promise(r=>setTimeout(r,20));}}
  if(!acquired)throw new AshRoomError('Room busy. Try again.',409);
  try{const room=await readRoomFile(id);if(Date.now()-Date.parse(room.createdAt)>24*3600000)throw new AshRoomError('This operational room expired. Create a new room.',410);const result=await action(room);await checkpointRoom(room);return result;}finally{await rm(lock,{recursive:true,force:true});}
}
export async function createRoom(input:Pick<AshRoom,'name'|'scenarioId'|'incident'|'runId'|'minute'|'basis'|'confirmationBasis'|'forecastIssuedAt'|'forecastOrigin'>,name:string){
  const root=roomDirectory();await mkdir(root,{recursive:true,mode:0o700});const files=(await readdir(root)).filter(file=>idPattern.test(file.replace(/\.json$/,''))&&file.endsWith('.json'));
  let retained=0;for(const file of files){try{const prior=JSON.parse(await readFile(path.join(root,file),'utf8')) as AshRoom;if(prior.version===1&&prior.id===file.slice(0,-5)&&Date.now()-Date.parse(prior.createdAt)>24*3600000){await rm(path.join(root,file));}else retained++;}catch{retained++;}}
  if(retained>=64)throw new AshRoomError('Room capacity reached. Reuse an active room; expired rooms are removed on the next creation attempt.',429);
  const now=new Date().toISOString(),id=randomUUID(),memberId=randomUUID();
  const room:AshRoom={version:1,id,createdAt:now,...input,members:[{id:memberId,name,joinedAt:now,seenAt:now}],events:[],proposals:[],floor:null,signals:[],signalSequence:0,calls:{}};
  appendRoomEvent(room,name,'joined',`${name} opened the room.`);await writeFile(path.join(root,`${id}.json`),JSON.stringify(room),{mode:0o600,flag:'wx'});return {room,memberId};
}
const limits=globalThis as typeof globalThis&{ashRoomLimits?:Map<string,{start:number;count:number}>};
export function roomRateLimit(key:string,max=90){const map=limits.ashRoomLimits??=new Map();const now=Date.now();for(const [id,v] of map)if(now-v.start>60000)map.delete(id);const entry=map.get(key)||{start:now,count:0};if(entry.count>=max)throw new AshRoomError('Too many requests. Retry shortly.',429);entry.count++;map.set(key,entry);}
