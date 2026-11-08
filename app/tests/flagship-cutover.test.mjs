// P06-R4: REAL HTTP calls backed by signed AllocationFlagship EVM transactions.
// No mocks, no production RPC, no demo guardian auto-approval.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const risk={market:'0',maximum:'200',reserve:'200'};
async function port() {return new Promise((yes,no)=>{
  const s=createServer();s.once('error',no);s.listen(0,'127.0.0.1',()=>{
    const n=s.address().port;s.close(()=>yes(n));
  });
});}
async function run() {
  const folder=mkdtempSync(join(tmpdir(),'covenant-flagship-cutover-'));
  const journal=join(folder,'audit.jsonl');
  const p=await port();
  const child=spawn(process.execPath,['app/server.mjs'],{
    cwd:root,env:{...process.env,PORT:String(p),COVENANT_RUNTIME:'flagship',COVENANT_AUDIT_PATH:journal},
    stdio:['ignore','pipe','pipe'],
  });
  let log='';
  const ready=new Promise((yes,no)=>{
    const clock=setTimeout(()=>no(Error('FLAGSHIP_SERVER_TIMEOUT:'+log)),30000);
    const check=b=>{
      log+=b.toString();
      if(log.includes('COVENANT_LOCAL_EVM=READY')&&log.includes('SINGLE_ALLOCATION_STATE=YES')) {
        clearTimeout(clock);yes();
      }
    };
    child.stdout.on('data',check);child.stderr.on('data',check);
    child.once('error',e=>{clearTimeout(clock);no(e);});
    child.once('exit',code=>{clearTimeout(clock);no(Error('FLAGSHIP_SERVER_EARLY_EXIT='+code+log));});
  });
  try{await ready;}catch(e){child.kill();rmSync(folder,{recursive:true,force:true});throw e;}
  async function req(route,body,expected=200) {
    const url=`http://127.0.0.1:${p}${route}`;
    const result=await fetch(url,body===undefined?undefined:{
      method:'POST',headers:{'content-type':'application/json',origin:`http://127.0.0.1:${p}`},
      body:JSON.stringify(body),
    });
    const content=await result.json();
    assert.equal(result.status,expected,`${route}: ${JSON.stringify(content)}`);
    return content;
  }
  async function close() {
    if(child.exitCode===null) {
      await new Promise(done=>{child.once('exit',done);child.kill();setTimeout(done,2000).unref();});
    }
    rmSync(folder,{recursive:true,force:true});
  }
  return {req,close,port:p,journal};
}
const coords=s=>[s.version,s.a,s.b,s.c];
function checkSynced(main,guard) {
  assert.deepEqual(coords(main),[guard.version,guard.x,guard.y,guard.z]);
  assert.equal(String(main.incident.phase),String(guard.incident.phase));
  assert.equal(String(main.incident.id),String(guard.incident.id));
  assert.deepEqual(main.deficits,{exposure:guard.deficits.exposure,reserve:guard.deficits.buffer});
}

test('R4 one flagship contract serves both browser surfaces; old desk, migrations, operations and planner share revision',
  {timeout:90000},async()=>{
  const s=await run();
  try {
    const html=await fetch(`http://127.0.0.1:${s.port}/`);
    assert.equal(html.status,200);
    const page=await html.text();
    for(const view of ['desk','migration','operations','planner','incident','catalog','history'])
      assert.ok(page.includes(`${view}View`),`seven-view page missing ${view}`);
    assert.ok(page.includes('incidentGuardianActivateBtn'));
    const first=await s.req('/api/state');
    const gs=await s.req('/api/guard/state');
    assert.match(first.runtime.engine,/AllocationFlagship/);
    assert.equal(first.runtime.address,gs.states.allocation.contract);
    assert.notEqual(first.runtime.address,gs.states.governance.contract);
    checkSynced(first.state,gs.states.allocation);
    assert.deepEqual(coords(first.state),['1','400','300','100']);
    const body={expectedVersion:'1',a:'350',b:'350',c:'100'};
    assert.equal((await s.req('/api/preview',{...body,role:'admin'})).preview.eligible,true);
    const denied=await s.req('/api/commit',{...body,role:'reviewer'});
    assert.equal(denied.result.success,false);
    assert.equal(denied.state.version,'1');
    const commit=await s.req('/api/commit',{...body,role:'admin'});
    assert.equal(commit.result.success,true,commit.result.error);
    assert.equal(commit.state.version,'2');
    checkSynced(commit.state,(await s.req('/api/guard/state')).states.allocation);
    const migration={expectedVersion:'2',role:'admin',steps:[
      {market:'0',value:'500'},{market:'1',value:'250'},{market:'0',value:'300'}]};
    const p=(await s.req('/api/migration/preview',migration)).preview;
    assert.equal(p.mask,0);assert.deepEqual(p.final,{a:'300',b:'250',c:'100'});
    const m=await s.req('/api/migration/commit',migration);
    assert.equal(m.result.success,true,m.result.error);
    assert.equal(m.state.version,'3');
    const ordered={expectedVersion:'3',role:'admin',steps:[{opcode:'1',amount:'50'}]};
    const a=await s.req('/api/actions/commit',ordered);
    assert.equal(a.result.success,true,a.result.error);
    assert.deepEqual(coords(a.state),['4','250','300','100']);
    const goal={expectedVersion:'4',role:'admin',goal:{kind:'shift',source:'1',destination:'0',quantity:'20'}};
    const plan=await s.req('/api/planner/plan',goal);
    assert.equal(plan.plan.status,'ready',JSON.stringify(plan.plan));
    const committed=await s.req('/api/planner/commit',{...goal,digest:plan.plan.digest});
    assert.equal(committed.result.success,true,committed.result.error);
    assert.deepEqual(coords(committed.state),['5','270','280','100']);
    checkSynced(committed.state,(await s.req('/api/guard/state')).states.allocation);
    const another=await s.req('/api/guard/commit',{
      domain:'allocation',role:'admin',expectedVersion:'5',x:'250',y:'300',z:'100'});
    assert.equal(another.result.success,true,another.result.error);
    assert.equal((await s.req('/api/state')).state.version,'6');
    assert.equal((await s.req('/api/guard/state')).states.governance.version,'1');
    const journal=await s.req('/api/history');
    assert.equal(journal.audit.verifiedAtStartup,true);
    assert.ok(journal.history.some(x=>x.operation==='planner'));
    assert.ok(journal.history.some(x=>x.operation==='guard_commit'));
    assert.ok(readFileSync(s.journal,'utf8').includes(another.result.transactionHash));
  } finally {await s.close();}
});

test('R4 guardian activation is separate; all ordinary routes enforce stored progressive deficit and bound release',
  {timeout:90000},async()=>{
  const s=await run();
  try {
    const request={domain:'allocation',mode:'progressive',expectedVersion:'1',
      market:'0',maximum:'200',bufferMinimum:'300'};
    const wrong=await s.req('/api/guard/activate',{...request,role:'admin'});
    assert.equal(wrong.result.success,false);
    const started=await s.req('/api/guard/activate',{...request,role:'guardian'});
    assert.equal(started.result.success,true,started.result.error);
    assert.equal(started.after.incident.phase,1);
    assert.deepEqual(started.after.deficits,{exposure:'200',buffer:'100'});
    checkSynced((await s.req('/api/state')).state,started.after);
    const bad=await s.req('/api/commit',{expectedVersion:'2',a:'400',b:'300',c:'100',role:'admin'});
    assert.equal(bad.result.success,false);
    assert.equal(bad.result.rejectionCategory,'PERSISTENT_INCIDENT_POLICY');
    assert.equal(bad.state.version,'2');
    const first=await s.req('/api/actions/commit',{expectedVersion:'2',role:'admin',steps:[{opcode:'9',amount:'100'}]});
    assert.equal(first.result.success,true,first.result.error);
    assert.deepEqual(first.state.deficits,{exposure:'100',reserve:'0'});
    const migration=await s.req('/api/migration/commit',{expectedVersion:'3',role:'admin',steps:[{market:'0',value:'350'}]});
    assert.equal(migration.result.success,false);
    assert.equal(migration.state.version,'3');
    const second=await s.req('/api/actions/commit',{expectedVersion:'3',role:'admin',steps:[{opcode:'9',amount:'100'}]});
    assert.equal(second.result.success,true,second.result.error);
    assert.equal(second.state.incident.phase,'2');
    const regression=await s.req('/api/guard/commit',{domain:'allocation',role:'admin',expectedVersion:'4',x:'250',y:'300',z:'100'});
    assert.equal(regression.result.success,false);
    const wrongId=await s.req('/api/guard/release',{domain:'allocation',role:'guardian',expectedVersion:'4',incidentId:'999'});
    assert.equal(wrongId.result.success,false);
    const noOperator=await s.req('/api/guard/release',{domain:'allocation',role:'admin',expectedVersion:'4',incidentId:'1'});
    assert.equal(noOperator.result.success,false);
    const released=await s.req('/api/guard/release',{domain:'allocation',role:'guardian',expectedVersion:'4',incidentId:'1'});
    assert.equal(released.result.success,true,released.result.error);
    assert.equal(released.after.incident.phase,0);
    checkSynced((await s.req('/api/state')).state,released.after);
  } finally {await s.close();}
});

test('R4 incident desk gives prospective choices but requires guardian-stored exact objective to commit',
  {timeout:90000},async()=>{
  const s=await run();
  try {
    const first={incident:risk,expectedVersion:'1',role:'admin'};
    const prospective=await s.req('/api/incident/assess',first);
    assert.equal(prospective.assessment.status,'requires_guardian');
    assert.equal(prospective.assessment.requiresGuardian,true);
    assert.ok(prospective.assessment.options.some(o=>o.status==='requires_guardian'));
    const chosen=prospective.assessment.options.find(o=>o.status==='requires_guardian');
    await s.req('/api/incident/commit',{...first,strategy:chosen.id,digest:chosen.digest},409);
    assert.equal((await s.req('/api/state')).state.version,'1');
    const active=await s.req('/api/guard/activate',{
      domain:'allocation',role:'guardian',mode:'progressive',expectedVersion:'1',
      market:risk.market,maximum:risk.maximum,bufferMinimum:risk.reserve,
    });
    assert.equal(active.result.success,true,active.result.error);
    await s.req('/api/incident/assess',{...first,expectedVersion:'2',incident:{...risk,maximum:'300'}},409);
    const attested=await s.req('/api/incident/assess',{...first,expectedVersion:'2'});
    const option=attested.assessment.options.find(o=>o.status==='ready');
    assert.ok(option,'the stored-objective Fe assessment should select a ready plan');
    const committed=await s.req('/api/incident/commit',{
      ...first,expectedVersion:'2',strategy:option.id,digest:option.digest,
    });
    assert.equal(committed.result.success,true,committed.result.error);
    assert.equal(committed.state.incident.phase,'2');
    assert.deepEqual(committed.state.deficits,{exposure:'0',reserve:'0'});
    const audit=await s.req('/api/history');
    assert.ok(audit.history.some(r=>r.operation==='incident'&&r.feIncidentMask===0));
  } finally {await s.close();}
});

test('R4 guardian atomic containment on the Guard tab changes the same flagship used by seven views',
  {timeout:90000},async()=>{
  const s=await run();
  try {
    const initial=await s.req('/api/state');
    assert.deepEqual(coords(initial.state),['1','400','300','100']);
    const activated=await s.req('/api/guard/activate',{
      domain:'allocation',role:'guardian',mode:'atomic',expectedVersion:'1',
      market:'0',maximum:'200',bufferMinimum:'300',x:'200',y:'300',z:'100',
    });
    assert.equal(activated.result.success,true,activated.result.error);
    assert.equal(activated.after.incident.phase,2);
    const seven=await s.req('/api/state');
    assert.deepEqual(coords(seven.state),['2','200','300','100']);
    checkSynced(seven.state,activated.after);
    const changed=await s.req('/api/commit',{
      expectedVersion:'2',a:'230',b:'300',c:'100',role:'admin',
    });
    assert.equal(changed.result.success,false);
    const preview=await s.req('/api/preview',{
      expectedVersion:'2',a:'230',b:'300',c:'100',role:'admin',
    });
    assert.equal(preview.preview.eligible,false);
    assert.ok(preview.preview.mask&128);
    const released=await s.req('/api/guard/release',{
      domain:'allocation',role:'guardian',expectedVersion:'2',incidentId:'1',
    });
    assert.equal(released.result.success,true,released.result.error);
    assert.equal((await s.req('/api/state')).state.version,'3');
  } finally {await s.close();}
});
