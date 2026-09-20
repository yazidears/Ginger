import {randomUUID} from 'node:crypto';
import {AshRoomError,appendRoomEvent,assertSameOrigin,authorizeMember,boundedText,changeRoom,requireFloor,requireRoomMember,roomBody,roomRateLimit,roomView} from '@/lib/ash-room-store';
import {approveRoomProposal,executeAshTool,toolForQuestion} from '@/lib/ash-room-tools';
import {createAshRealtimeSecret} from '@/lib/ash-realtime';
import type {AshToolName} from '@/lib/ash-room-types';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};
type Context={params:Promise<{id:string}>};
function fail(error:unknown){return Response.json({error:error instanceof AshRoomError?error.message:'Room request unavailable. Please retry.'},{status:error instanceof AshRoomError?error.status:503,headers});}
export async function GET(request:Request,context:Context){
  try{const {id}=await context.params;const memberId=authorizeMember(request,id);roomRateLimit(`poll:${memberId}`,150);const since=Number(new URL(request.url).searchParams.get('afterSignal')||0);
    return Response.json(await changeRoom(id,room=>{const member=requireRoomMember(room,memberId);member.seenAt=new Date().toISOString();if(room.floor?.memberId===memberId&&room.floor.expiresAt>Date.now())room.floor.expiresAt=Date.now()+15000;return roomView(room,memberId,Number.isFinite(since)?since:0);}),{headers});
  }catch(error){return fail(error);}
}
export async function POST(request:Request,context:Context){
  try{
    assertSameOrigin(request);const {id}=await context.params;const memberId=authorizeMember(request,id);roomRateLimit(`action:${memberId}`,100);const body=await roomBody(request);
    if(body.action==='session'){
      roomRateLimit(`session:${memberId}`,4);
      const snapshot=await changeRoom(id,room=>{requireFloor(room,memberId);const key=`session:${room.floor!.generation}`;if(room.calls[key])throw new AshRoomError('This voice session has already started. End it before reconnecting.',409);room.calls[key]={at:Date.now(),result:true};appendRoomEvent(room,requireRoomMember(room,memberId).name,'session','Voice session requested.');return structuredClone(room);});
      return Response.json(await createAshRealtimeSecret(snapshot,memberId),{headers});
    }
    const output=await changeRoom(id,async room=>{
      const member=requireRoomMember(room,memberId);member.seenAt=new Date().toISOString();
      if(body.action==='claim-floor'){
        if(room.floor&&room.floor.expiresAt>Date.now()&&room.floor.memberId!==memberId)throw new AshRoomError('Another participant has the microphone. Listen or wait for them to end.',409);
        if(room.floor?.memberId===memberId&&room.floor.expiresAt>Date.now())throw new AshRoomError('You already have an active voice session. End it before reconnecting.',409);
        room.floor={memberId,expiresAt:Date.now()+15000,generation:randomUUID()};appendRoomEvent(room,member.name,'session',`${member.name} has the microphone floor.`);return roomView(room,memberId);
      }
      if(body.action==='release-floor'){
        if(room.floor?.memberId===memberId){room.floor=null;room.signals=[];appendRoomEvent(room,member.name,'session',`${member.name} ended the voice session.`);}return roomView(room,memberId);
      }
      if(body.action==='signal'){
        const to=boundedText(body.to,36,'Participant');requireRoomMember(room,to);if(!room.floor||room.floor.expiresAt<Date.now()||(room.floor.memberId!==memberId&&room.floor.memberId!==to))throw new AshRoomError('Audio signaling is limited to the current microphone floor.',409);
        const description=body.description as RTCSessionDescriptionInit|undefined;if(!description||!['offer','answer'].includes(description.type)||typeof description.sdp!=='string'||description.sdp.length>40000)throw new AshRoomError('Invalid audio signaling.');
        room.signals=room.signals.filter(s=>s.at>Date.now()-60000).slice(-100);room.signals.push({sequence:++room.signalSequence,from:memberId,to,at:Date.now(),description});return {ok:true};
      }
      if(body.action==='tool'||body.action==='ask'){
        if(body.action==='tool')requireFloor(room,memberId);
        const callId=boundedText(body.callId,100,'Call ID'),key=`${memberId}:${callId}`;if(room.calls[key])return room.calls[key].result;
        const tool=body.action==='ask'?toolForQuestion(boundedText(body.question,1000,'Question')):{name:boundedText(body.name,80,'Tool') as AshToolName,args:body.args&&typeof body.args==='object'&&!Array.isArray(body.args)?body.args as Record<string,unknown>:{}};
        const result={tool:tool.name,result:await executeAshTool(room,memberId,tool.name,tool.args)};room.calls[key]={at:Date.now(),result};room.calls=Object.fromEntries(Object.entries(room.calls).sort((a,b)=>b[1].at-a[1].at).slice(0,60));return result;
      }
      if(body.action==='confirm'){
        const proposalId=boundedText(body.proposalId,36,'Proposal');if(body.decision!=='approve'&&body.decision!=='reject')throw new AshRoomError('Choose approve or reject.');
        if(body.confirmation!==`${body.decision}:${proposalId}`)throw new AshRoomError('Review the exact proposal before confirming.',403);
        return approveRoomProposal(room,memberId,proposalId,body.decision);
      }
      if(body.action==='leave'){
        if(room.floor?.memberId===memberId)room.floor=null;appendRoomEvent(room,member.name,'left',`${member.name} left the room.`);room.members=room.members.filter(m=>m.id!==memberId);return {ok:true};
      }
      throw new AshRoomError('Room action not permitted.',403);
    });
    return Response.json(output,{headers});
  }catch(error){return fail(error);}
}
