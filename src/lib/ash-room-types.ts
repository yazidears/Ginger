import type {OperationalEvent, OperationalRoomContext} from './product-contracts';

export type RoomMember = {id:string; name:string; joinedAt:string; seenAt:string};
export type RoomProposal = {
  id:string; kind:'draft-task'|'field-report'|'new-run'; text:string; createdBy:string; createdAt:string;
  status:'pending'|'executing'|'approved'|'rejected'|'failed'; runId:string; resultId?:string; error?:string;
};
export type RoomSignal = {sequence:number; from:string; to:string; at:number; description:RTCSessionDescriptionInit};
export type AshRoom = OperationalRoomContext & {
  version:1; basis:'hypothetical'|'confirmed-incident'; confirmationBasis:string|null; forecastIssuedAt:string; forecastOrigin:string; members:RoomMember[]; events:OperationalEvent[]; proposals:RoomProposal[];
  floor:{memberId:string; expiresAt:number; generation:string}|null;
  signals:RoomSignal[]; signalSequence:number;
  calls:Record<string,{at:number; result:unknown}>;
};
export type RoomView = Omit<AshRoom,'signals'|'calls'> & {memberId:string; signals:RoomSignal[]; voiceConfigured:boolean; iceServers:RTCIceServer[]; audioNetwork:'relay-configured'|'same-network'};
export type AshToolName = 'incident_status'|'latest_forecast'|'asset_exposure'|'compare_forecasts'|'operational_history'|'propose_action';
export type VoicePhase = 'disconnected'|'connecting'|'listening'|'processing'|'speaking'|'muted'|'room-listening';
