import {randomUUID} from 'node:crypto';
import {readRun,listRuns} from '@/lib/sage/jobs';
import {AshRoomError,appendRoomEvent,assertSameOrigin,authorizeBootstrap,boundedText,changeRoom,createRoom,memberToken,publicDemo,roomBody,roomCookie,roomRateLimit,roomSecret,roomView} from '@/lib/ash-room-store';
import type {ScenarioContext} from '@/lib/product-contracts';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};
export async function GET(){let configured=true;try{roomSecret();}catch{configured=false;}return Response.json({configured,publicDemo:publicDemo(),voiceConfigured:Boolean(process.env.OPENAI_API_KEY),model:process.env.ASH_REALTIME_MODEL||'gpt-realtime-2.1'}, {headers});}
export async function POST(request:Request){
  try{
    assertSameOrigin(request);roomRateLimit('bootstrap',30);const body=await roomBody(request);authorizeBootstrap(body.accessToken);
    if(body.action==='catalog')return Response.json({runs:(await listRuns()).filter(r=>r.state==='completed').map(r=>({id:r.id,createdAt:r.createdAt,lat:r.request.lat,lon:r.request.lon,basis:r.request.mode==='scenario'?'Hypothetical':'Operator-confirmed',horizonMinutes:r.request.horizonMinutes}))},{headers});
    const name=boundedText(body.name,60,'Your name');let roomId:string,memberId:string;
    if(body.action==='join'){
      roomId=boundedText(body.roomId,36,'Room ID');memberId=randomUUID();const now=new Date().toISOString();
      await changeRoom(roomId,room=>{room.members=room.members.filter(m=>Date.now()-Date.parse(m.seenAt)<12*3600000);if(room.members.length>=8)throw new AshRoomError('This room already has eight participants.',409);room.members.push({id:memberId,name,joinedAt:now,seenAt:now});appendRoomEvent(room,name,'joined',`${name} joined the room.`);});
    }else if(body.action==='create'){
      const runId=boundedText(body.runId,36,'Sage run');const run=(await readRun(runId))?.result;if(!run)throw new AshRoomError('Choose a completed Sage run.',409);
      const minute=body.minute===undefined?0:Number(body.minute);if(!Number.isFinite(minute)||minute<0||minute>run.request.horizonMinutes)throw new AshRoomError('Time must be inside the selected forecast horizon.');
      const scenario=(run as typeof run&{scenario?:ScenarioContext}).scenario;
      const created=await createRoom({name:boundedText(body.roomName||scenario?.name||'Sage operations room',100,'Room name'),scenarioId:scenario?.id||null,incident:scenario?.incident||null,basis:run.request.mode==='scenario'?'hypothetical':'confirmed-incident',confirmationBasis:run.request.confirmation||null,forecastIssuedAt:run.generatedAt,forecastOrigin:run.forecastOrigin,runId,minute},name);roomId=created.room.id;memberId=created.memberId;
    }else throw new AshRoomError('Choose create or join.');
    const token=memberToken(roomId,memberId);const view=await changeRoom(roomId,room=>roomView(room,memberId));
    return Response.json({room:view,memberToken:token},{status:201,headers:{...headers,'Set-Cookie':roomCookie(request,roomId,token)}});
  }catch(error){return Response.json({error:error instanceof AshRoomError?error.message:'Ash rooms unavailable.'},{status:error instanceof AshRoomError?error.status:503,headers});}
}
