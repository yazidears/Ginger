import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
export type OperationLocation={name:string;lat:number;lon:number};
export type OperationTask={planId?:string;category?:'prevention'|'assets'|'coordination';reason?:string;evidenceAt?:string;sourceNames?:string[];checks?:{text:string;done:boolean}[];owner?:string;dueAt?:string;id:string;title:string;priority:'routine'|'high';status:'open'|'acknowledged'|'completed';location:OperationLocation;createdAt:string;updatedAt:string};
export type FieldObservation={taskId?:string;id:string;text:string;location:OperationLocation;createdAt:string;source:'operator-entered';verification:'unverified'};
export type OperationAudit={id:string;time:string;action:string;subjectId:string};
export type OperationsState={version:1;tasks:OperationTask[];observations:FieldObservation[];audit:OperationAudit[]};
const root=join(process.cwd(),'.ginger-data');
const file=join(root,'operations.json');
const queue=globalThis as typeof globalThis & {gingerOperationsWrite?:Promise<unknown>};
export class OperationsInputError extends Error {}
function text(value:unknown,max:number):string{if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw new OperationsInputError(`Text must contain 1–${max} characters.`);return value.trim();}
function location(value:unknown):OperationLocation{if(!value||typeof value!=='object')throw new OperationsInputError('Location is required.');const p=value as Record<string,unknown>;if(typeof p.lat!=='number'||!Number.isFinite(p.lat)||Math.abs(p.lat)>90||typeof p.lon!=='number'||!Number.isFinite(p.lon)||Math.abs(p.lon)>180)throw new OperationsInputError('Invalid coordinates.');return {name:text(p.name,120),lat:p.lat,lon:p.lon};}
export async function readOperations():Promise<OperationsState>{try{const data=JSON.parse(await readFile(file,'utf8')) as OperationsState;if(data.version!==1||!Array.isArray(data.tasks)||!Array.isArray(data.observations)||!Array.isArray(data.audit))throw Error('Invalid operations storage');return data;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {version:1,tasks:[],observations:[],audit:[]};throw error;}}
export async function mutateOperations(input:unknown):Promise<OperationsState>{
 const run=async()=>{if(!input||typeof input!=='object')throw new OperationsInputError('Invalid request.');const body=input as Record<string,unknown>;const state=await readOperations();const now=new Date().toISOString();let subjectId='';let action='';
 if(body.action==='create-plan-task'){
  const {assessLocation}=await import('./assessment');const {buildPreventionPlan}=await import('./prevention-plan');
  const place=location(body.location);const planId=text(body.planId,80);
  const duplicate=state.tasks.find(t=>t.planId===planId&&t.status!=='completed'&&t.location.lat===place.lat&&t.location.lon===place.lon);if(duplicate)return state;
  if(state.tasks.length>=5000)throw new OperationsInputError('Task storage limit reached.');
  const proposal=buildPreventionPlan(await assessLocation(place.lat,place.lon)).find(p=>p.id===planId);if(!proposal)throw new OperationsInputError('Evidence changed. Refresh the plan.');
  const task:OperationTask={id:randomUUID(),planId,category:proposal.category,title:proposal.title,priority:proposal.priority,reason:proposal.reason,evidenceAt:proposal.evidenceAt,sourceNames:proposal.sourceNames,checks:proposal.checks.map(text=>({text,done:false})),status:'open',location:place,createdAt:now,updatedAt:now};state.tasks.unshift(task);subjectId=task.id;action='Evidence-linked inspection created';
 }
 else if(body.action==='update-check'){const task=state.tasks.find(t=>t.id===body.id);if(!task||task.status==='completed'||!Number.isInteger(body.index)||typeof body.done!=='boolean'||!task.checks?.[Number(body.index)])throw new OperationsInputError('Invalid checklist update.');task.checks[Number(body.index)].done=body.done;task.updatedAt=now;subjectId=task.id;action='Inspection checklist updated';}
 else if(body.action==='assign-task'){const task=state.tasks.find(t=>t.id===body.id);if(!task||task.status==='completed')throw new OperationsInputError('Task unavailable.');task.owner=text(body.owner,120);if(typeof body.dueAt!=='string'||!Number.isFinite(Date.parse(body.dueAt)))throw new OperationsInputError('Use a valid review time.');task.dueAt=new Date(body.dueAt).toISOString();task.updatedAt=now;subjectId=task.id;action='Inspection owner and review time recorded';}
 else if(body.action==='create-task'){if(state.tasks.length>=5000)throw new OperationsInputError('Task storage limit reached.');const priority=body.priority;if(priority!=='routine'&&priority!=='high')throw new OperationsInputError('Invalid priority.');const task:OperationTask={id:randomUUID(),title:text(body.title,240),priority,status:'open',location:location(body.location),createdAt:now,updatedAt:now};state.tasks.unshift(task);subjectId=task.id;action='Inspection task created';}
 else if(body.action==='update-task'){const id=text(body.id,80);const task=state.tasks.find(t=>t.id===id);if(!task)throw new OperationsInputError('Task not found.');const status=body.status;if(status!=='acknowledged'&&status!=='completed')throw new OperationsInputError('Invalid status.');if(task.status==='completed'||task.status===status)throw new OperationsInputError('This transition is no longer available.');if(status==='completed'&&task.checks?.some(c=>!c.done))throw new OperationsInputError('Finish the checklist before completing this inspection.');task.status=status;task.updatedAt=now;subjectId=id;action=`Inspection task ${status}`;}
 else if(body.action==='add-observation'){if(state.observations.length>=5000)throw new OperationsInputError('Observation storage limit reached.');if(body.taskId!==undefined&&!state.tasks.some(t=>t.id===body.taskId))throw new OperationsInputError('Inspection not found.');const observation:FieldObservation={...(typeof body.taskId==='string'?{taskId:body.taskId}:{}),id:randomUUID(),text:text(body.text,2000),location:location(body.location),createdAt:now,source:'operator-entered',verification:'unverified'};state.observations.unshift(observation);subjectId=observation.id;action='Unverified field observation recorded';}
 else throw new OperationsInputError('Unknown operation.');
 state.audit.unshift({id:randomUUID(),time:now,action,subjectId});await mkdir(root,{recursive:true,mode:0o700});const temporary=join(root,`operations-${randomUUID()}.tmp`);await writeFile(temporary,JSON.stringify(state,null,2),{mode:0o600});await rename(temporary,file);return state;};
 const result=(queue.gingerOperationsWrite??Promise.resolve()).then(run,run);queue.gingerOperationsWrite=result.catch(()=>{});return result;
}
