import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
async function main(){
 const dir=await mkdtemp(join(tmpdir(),'ginger-prevention-')),cwd=process.cwd(),original=global.fetch;
 process.chdir(dir);global.fetch=async()=>new Response('',{status:403});
 try{
  const {mutateOperations,readOperations}=await import('../src/lib/operations');
  const location={name:'Test place',lat:41.73,lon:1.83};
  let state=await mutateOperations({action:'create-plan-task',planId:'mitigation-review',location});const task=state.tasks[0];
  assert.equal(task.checks?.length,3);assert.ok(task.evidenceAt);assert.equal(task.category,'prevention');
  state=await mutateOperations({action:'create-plan-task',planId:'mitigation-review',location});assert.equal(state.tasks.length,1,'Repeated creates reuse the active task');
  await assert.rejects(mutateOperations({action:'update-task',id:task.id,status:'completed'}),/checklist/);
  await assert.rejects(mutateOperations({action:'update-check',id:task.id,index:99,done:true}),/checklist/);
  await mutateOperations({action:'assign-task',id:task.id,owner:'Test inspector',dueAt:'2026-09-20T09:00:00Z'});
  await mutateOperations({action:'add-observation',taskId:task.id,location,text:'Test field evidence; unverified'});
  for(let index=0;index<3;index++)await mutateOperations({action:'update-check',id:task.id,index,done:true});
  await mutateOperations({action:'update-task',id:task.id,status:'completed'});
  state=await readOperations();assert.equal(state.tasks[0].owner,'Test inspector');assert.equal(state.tasks[0].status,'completed');assert.equal(state.observations[0].taskId,task.id);assert.equal(state.observations[0].verification,'unverified');
  await assert.rejects(mutateOperations({action:'update-check',id:task.id,index:0,done:false}));
  await assert.rejects(mutateOperations({action:'add-observation',taskId:'missing',location,text:'Invalid link'}));
  const monitoring=await mutateOperations({action:'create-plan-task',planId:'zone-monitoring',location});
  assert.equal(monitoring.tasks.find(t=>t.planId==='zone-monitoring')?.checks?.length,3);
  await mutateOperations({action:'create-plan-task',planId:'zone-monitoring',location});
  assert.equal((await readOperations()).tasks.filter(t=>t.planId==='zone-monitoring').length,1);
  await assert.rejects(mutateOperations({action:'create-plan-task',planId:'patrol-attention',location}),/Evidence changed/);
  console.log('PASS server-generated plans, deduplication, checklist completion, assignments, linked reports and completed-task guards');
 }finally{global.fetch=original;process.chdir(cwd);await rm(dir,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
