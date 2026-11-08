import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
async function freePort() {
  return new Promise((resolvePort, reject) => {
    const socket = createServer();
    socket.once('error', reject);
    socket.listen(0,'127.0.0.1',() => {
      const port = socket.address().port;
      socket.close(() => resolvePort(port));
    });
  });
}

async function startServer(port, filepath) {
  const proc = spawn(process.execPath, ['app/server.mjs'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), COVENANT_AUDIT_PATH: filepath },
    stdio: ['ignore','pipe','pipe'],
  });
  let output = '';
  const ready = new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(Error(`Server readiness timed out: ${output}`)), 18000);
    const onText = (chunk) => {
      output += chunk.toString();
      if (output.includes('COVENANT_LOCAL_EVM=READY')) {
        clearTimeout(timeout);
        resolveReady();
      }
    };
    proc.stdout.on('data', onText);
    proc.stderr.on('data', onText);
    proc.once('exit', (code) => {
      clearTimeout(timeout);
      reject(Error(`Server exited early (${code}): ${output}`));
    });
    proc.once('error', reject);
  });
  try { await ready; }
  catch(e) { proc.kill(); throw e; }
  return proc;
}

async function request(port, path, data) {
  const origin = `http://127.0.0.1:${port}`;
  const response = await fetch(origin + path, data ? {
    method:'POST', headers:{ 'content-type':'application/json','origin':origin }, body:JSON.stringify(data),
  } : undefined);
  if (response.status !== 200) throw Error(`${path} returned ${response.status}: ${await response.text()}`);
  return response.json();
}

async function stop(proc) {
  if (proc.exitCode !== null) return;
  await new Promise(resolveStopped => {
    proc.once('exit', resolveStopped);
    proc.kill();
    setTimeout(resolveStopped, 2000).unref();
  });
}

test('HTTP workspace: Fe preview includes signer, transactions are audited, prior session remains distinct', {timeout: 45000}, async () => {
  const tmp = mkdtempSync(join(tmpdir(),'covenant-http-'));
  const auditPath = join(tmp,'audit.jsonl');
  const port = await freePort();
  let proc;
  try {
    proc = await startServer(port,auditPath);
    const initial = await request(port,'/api/state');
    assert.equal(initial.state.version,'1');
    const initialSession = initial.audit.sessionId;
    const proposal = { expectedVersion:'1', a:'350',b:'350',c:'150' };
    const preview = (await request(port,'/api/preview',{...proposal,role:'admin'})).preview;
    assert.equal(preview.mask,0);
    assert.equal(preview.eligible,true);
    const wrongActor = (await request(port,'/api/preview',{...proposal,role:'reviewer'})).preview;
    assert.equal(wrongActor.allowed,true);
    assert.equal(wrongActor.authorized,false);
    assert.equal(wrongActor.eligible,false);
    const reviewer = await request(port,'/api/commit',{...proposal,role:'reviewer'});
    assert.equal(reviewer.result.success,false);
    assert.equal(reviewer.result.rejectionCategory,'UNAUTHORIZED_OPERATOR');
    assert.equal(reviewer.state.version,'1');
    const ok = await request(port,'/api/commit',{...proposal,role:'admin'});
    assert.equal(ok.result.success,true);
    assert.equal(ok.state.version,'2');
    assert.match(ok.result.transactionHash,/^0x[0-9a-fA-F]{64}$/);
    const stale = await request(port,'/api/commit',{...proposal,role:'admin'});
    assert.equal(stale.result.success,false);
    assert.equal(stale.result.rejectionCategory,'STALE_VERSION');
    assert.equal(stale.state.version,'2');
    const history = await request(port,'/api/history');
    assert.equal(history.history.length,3);
    assert.equal(history.history[0].rejectionCategory,'STALE_VERSION');
    assert.equal(history.history[1].after.version,'2');
    assert.equal(history.history[2].after.version,'1');
    assert.ok(readFileSync(auditPath,'utf8').includes(ok.result.transactionHash));
    const exported = await request(port,'/api/history/export');
    assert.equal(exported.transactions.length,3);
    assert.equal(exported.journalEntries.length,4);
    assert.match(exported.journalEntries.at(-1).digest,/^[0-9a-f]{64}$/);
    await stop(proc);
    proc = await startServer(port,auditPath);
    const restarted = await request(port,'/api/state');
    assert.equal(restarted.state.version,'1', 'the local EVM resets');
    assert.notEqual(restarted.audit.sessionId,initialSession);
    const restoredHistory = await request(port,'/api/history');
    assert.equal(restoredHistory.history.length,3,'audit survives restart');
    assert.equal(restoredHistory.audit.verifiedAtStartup,true);
  } finally {
    if (proc) await stop(proc);
    rmSync(tmp,{recursive:true,force:true});
  }
});

test('HTTP migration studio: stage-level Fe evidence, one atomic transaction, audit persistence', {timeout: 45000}, async () => {
  const tmp = mkdtempSync(join(tmpdir(),'covenant-migration-'));
  const auditPath = join(tmp,'audit.jsonl');
  const port = await freePort();
  const plan = {expectedVersion:'1',role:'admin',steps:[
    {market:'0',value:'550'},{market:'1',value:'200'},{market:'0',value:'350'},
  ]};
  let proc;
  try {
    proc = await startServer(port,auditPath);
    const init = await request(port,'/api/state');
    assert.equal(init.state.version,'1');
    const preview = (await request(port,'/api/migration/preview',plan)).preview;
    assert.deepEqual(preview.stageMasks,[4,8,0]);
    assert.equal(preview.mask,0);
    assert.equal(preview.eligible,true);
    assert.deepEqual(preview.final,{a:'350',b:'200',c:'100'});
    assert.equal((await request(port,'/api/state')).state.version,'1');
    const bad = {...plan,steps:[...plan.steps.slice(0,2),{market:'0',value:'500'}]};
    const blocked = await request(port,'/api/migration/commit',bad);
    assert.equal(blocked.result.success,false);
    assert.equal(blocked.result.rejectionCategory,'POLICY_INVARIANT');
    assert.equal(blocked.state.version,'1');
    assert.deepEqual(blocked.state.a,'400');
    const reviewer = await request(port,'/api/migration/commit',{...plan,role:'reviewer'});
    assert.equal(reviewer.result.success,false);
    assert.equal(reviewer.result.rejectionCategory,'UNAUTHORIZED_OPERATOR');
    assert.equal(reviewer.state.version,'1');
    const ok = await request(port,'/api/migration/commit',plan);
    assert.equal(ok.result.success,true);
    assert.equal(ok.state.version,'2');
    assert.deepEqual([ok.state.a,ok.state.b,ok.state.c],['350','200','100']);
    assert.match(ok.result.transactionHash,/^0x[0-9a-f]{64}$/i);
    assert.ok(BigInt(ok.result.gasSpent)>0n);
    const stale = await request(port,'/api/migration/commit',plan);
    assert.equal(stale.result.success,false);
    assert.equal(stale.result.rejectionCategory,'STALE_VERSION');
    assert.equal(stale.state.version,'2');
    const history = await request(port,'/api/history');
    assert.equal(history.history.length,4);
    const accepted = history.history.find(x=>x.outcome==='committed');
    assert.equal(accepted.operation,'migration');
    assert.deepEqual(accepted.stageMasks,[4,8,0]);
    assert.equal(accepted.proposal.steps.length,3);
    assert.deepEqual(accepted.fePreviewFinal,{a:'350',b:'200',c:'100'});
    const exportResult = await request(port,'/api/history/export');
    assert.equal(exportResult.transactions.length,4);
    assert.equal(exportResult.journalEntries.length,5);
    await stop(proc);
    proc = await startServer(port,auditPath);
    assert.equal((await request(port,'/api/state')).state.version,'1','new local EVM session resets');
    const restored = await request(port,'/api/history');
    assert.equal(restored.history.length,4);
    assert.equal(restored.audit.verifiedAtStartup,true);
  } finally {
    if (proc) await stop(proc);
    rmSync(tmp,{recursive:true,force:true});
  }
});

test('HTTP operations studio: Fe operational order, policy rollback, journal verification and restart persistence', {timeout:45000}, async () => {
  const tmp=mkdtempSync(join(tmpdir(),'covenant-operations-'));
  const auditPath=join(tmp,'audit.jsonl');
  const port=await freePort();let proc;
  const safe={expectedVersion:'1',role:'admin',steps:[
    {opcode:'9',amount:'250'}, // retire Core
    {opcode:'13',amount:'250'}, // issue Supporting
    {opcode:'3',amount:'100'}, // transfer Supporting -> Core
  ]};
  try {
    proc=await startServer(port,auditPath);
    const initial=await request(port,'/api/state');
    assert.equal(initial.state.version,'1');
    const preview=(await request(port,'/api/actions/preview',safe)).preview;
    assert.equal(preview.mask,0);
    assert.deepEqual(preview.stageMasks,[0,2,0]);
    assert.deepEqual(preview.final,{a:'250',b:'450',c:'100'});
    assert.equal((await request(port,'/api/state')).state.version,'1');

    const wrongOrder={...safe,steps:[safe.steps[1],safe.steps[0],safe.steps[2]]};
    const rejectedPreview=(await request(port,'/api/actions/preview',wrongOrder)).preview;
    assert.equal(rejectedPreview.operationError,21);
    assert.equal(rejectedPreview.mask,64);
    const rejected=await request(port,'/api/actions/commit',wrongOrder);
    assert.equal(rejected.result.success,false);
    assert.equal(rejected.result.rejectionCategory,'OPERATION_PRECONDITION');
    assert.equal(rejected.state.version,'1');

    const unsafe={...safe,steps:[safe.steps[0],safe.steps[1],{opcode:'16',amount:'550'}]};
    const policyFail=await request(port,'/api/actions/commit',unsafe);
    assert.equal(policyFail.result.success,false);
    assert.equal(policyFail.result.rejectionCategory,'POLICY_INVARIANT');
    assert.equal(policyFail.state.version,'1');

    const unauthorized=await request(port,'/api/actions/commit',{...safe,role:'reviewer'});
    assert.equal(unauthorized.result.success,false);
    assert.equal(unauthorized.result.rejectionCategory,'UNAUTHORIZED_OPERATOR');
    assert.equal(unauthorized.state.version,'1');

    const committed=await request(port,'/api/actions/commit',safe);
    assert.equal(committed.result.success,true);
    assert.equal(committed.state.version,'2');
    assert.deepEqual([committed.state.a,committed.state.b,committed.state.c],['250','450','100']);
    assert.match(committed.result.transactionHash,/^0x[0-9a-fA-F]{64}$/);
    const stale=await request(port,'/api/actions/commit',safe);
    assert.equal(stale.result.success,false);
    assert.equal(stale.result.rejectionCategory,'STALE_VERSION');
    assert.equal(stale.state.version,'2');

    const history=await request(port,'/api/history');
    assert.equal(history.history.length,5);
    const accepted=history.history.find(x=>x.outcome==='committed');
    assert.equal(accepted.operation,'actions');
    assert.equal(accepted.operationError,0);
    assert.deepEqual(accepted.stageMasks,[0,2,0]);
    assert.equal(accepted.proposal.steps[0].opcode,'9');
    const opFailure=history.history.find(x=>x.rejectionCategory==='OPERATION_PRECONDITION');
    assert.equal(opFailure.operationError,21);
    assert.equal(opFailure.policyMask,64);
    const exported=await request(port,'/api/history/export');
    assert.equal(exported.transactions.length,5);
    assert.equal(exported.journalEntries.length,6);
    await stop(proc);
    proc=await startServer(port,auditPath);
    assert.equal((await request(port,'/api/state')).state.version,'1');
    const previous=await request(port,'/api/history');
    assert.equal(previous.history.length,5);
    assert.equal(previous.audit.verifiedAtStartup,true);
    assert.notEqual(previous.audit.sessionId, initial.audit.sessionId);
  } finally {
    if(proc) await stop(proc);
    rmSync(tmp,{recursive:true,force:true});
  }
});

test('HTTP goal planner: live-state plans, goal-attested commits, immutable audit, unauthorized and stale rejection', {timeout:45000},async()=>{
  const tmp=mkdtempSync(join(tmpdir(),'covenant-planner-'));
  const auditPath=join(tmp,'audit.jsonl'),port=await freePort();let proc;
  const targetGoal={kind:'target',a:'250',b:'450',c:'100'};
  try {
    proc=await startServer(port,auditPath);
    const a=await request(port,'/api/planner/plan',{expectedVersion:'1',role:'admin',goal:targetGoal});
    assert.equal(a.plan.status,'ready');
    assert.equal(a.plan.steps.length,1,'planner should prefer direct transfer over legacy three-step preset');
    assert.deepEqual(a.plan.steps,[{opcode:'1',amount:'150'}]);
    assert.deepEqual(a.plan.preview.final,a.plan.target);
    const reviewer=await request(port,'/api/planner/plan',{expectedVersion:'1',role:'reviewer',goal:targetGoal});
    assert.equal(reviewer.plan.status,'unauthorized');
    const infeasible=await request(port,'/api/planner/plan',{expectedVersion:'1',role:'admin',goal:{kind:'target',a:'150',b:'550',c:'100'}});
    assert.equal(infeasible.plan.status,'infeasible');
    assert.ok(infeasible.plan.preview.mask & 2);
    // The old plan cannot be reused with another goal, even from the same version.
    const tamper=await fetch(`http://127.0.0.1:${port}/api/planner/commit`,{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
        expectedVersion:'1',role:'admin',goal:{kind:'target',a:'250',b:'449',c:'100'},digest:a.plan.digest,
      }),
    });
    assert.equal(tamper.status,409);
    assert.equal((await request(port,'/api/state')).state.version,'1');
    const committed=await request(port,'/api/planner/commit',{
      expectedVersion:'1',role:'admin',goal:targetGoal,digest:a.plan.digest,
    });
    assert.equal(committed.result.success,true);
    assert.equal(committed.state.version,'2');
    assert.deepEqual([committed.state.a,committed.state.b,committed.state.c],['250','450','100']);
    const stale=await fetch(`http://127.0.0.1:${port}/api/planner/commit`,{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
        expectedVersion:'1',role:'admin',goal:targetGoal,digest:a.plan.digest,
      }),
    });
    assert.equal(stale.status,409,'stale plan must not submit an EVM transaction');
    const moveGoal={kind:'shift',source:'0',destination:'1',quantity:'50'};
    const next=(await request(port,'/api/planner/plan',{expectedVersion:'2',role:'admin',goal:moveGoal})).plan;
    assert.equal(next.status,'ready');
    assert.deepEqual(next.target,{a:'200',b:'500',c:'100'});
    assert.deepEqual(next.steps,[{opcode:'1',amount:'50'}]);
    const follow=await request(port,'/api/planner/commit',{
      expectedVersion:'2',role:'admin',goal:moveGoal,digest:next.digest,
    });
    assert.equal(follow.result.success,true);
    assert.equal(follow.state.version,'3');
    const already=(await request(port,'/api/planner/plan',{expectedVersion:'3',role:'admin',goal:{kind:'target',a:'200',b:'500',c:'100'}})).plan;
    assert.equal(already.status,'already_satisfied');
    const history=await request(port,'/api/history');
    assert.equal(history.history.length,2,'only genuine submitted transactions enter the journal');
    assert.equal(history.history[0].operation,'planner');
    assert.deepEqual(history.history[0].target,{a:'200',b:'500',c:'100'});
    assert.match(history.history[0].planFingerprint,/^[0-9a-f]{64}$/);
    assert.ok(BigInt(history.history[0].gasSpent)>0n);
    const exported=await request(port,'/api/history/export');
    assert.equal(exported.transactions.length,2);
    assert.equal(exported.journalEntries.length,3);
    await stop(proc);proc=await startServer(port,auditPath);
    assert.equal((await request(port,'/api/state')).state.version,'1');
    const restored=await request(port,'/api/history');
    assert.equal(restored.history.length,2);
    assert.equal(restored.audit.verifiedAtStartup,true);
  }finally{if(proc)await stop(proc);rmSync(tmp,{recursive:true,force:true});}
});

test('HTTP incident desk: three Fe-verified responses, exact terminal commitment, stale and tampered plans blocked', {timeout:45000},async()=>{
  const tmp=mkdtempSync(join(tmpdir(),'covenant-incident-'));
  const auditPath=join(tmp,'audit.jsonl'),port=await freePort();let proc;
  const scenario={incident:{market:'0',maximum:'200',reserve:'200'},expectedVersion:'1',role:'admin'};
  try {
    proc=await startServer(port,auditPath);
    const assessed=(await request(port,'/api/incident/assess',scenario)).assessment;
    assert.equal(assessed.status,'assessed');
    assert.equal(assessed.options.length,3);
    const opts=Object.fromEntries(assessed.options.map(o=>[o.id,o]));
    assert.equal(opts.continuity.status,'ready');
    assert.deepEqual(opts.continuity.target,{a:'200',b:'500',c:'100'});
    assert.equal(opts.reserve.status,'ready');
    assert.deepEqual(opts.reserve.target,{a:'200',b:'300',c:'100'});
    assert.equal(opts.reserve.metrics.reserve,'400');
    assert.equal(opts.spread.status,'ready');
    assert.notDeepEqual(opts.spread.target,opts.continuity.target);
    const altered=await fetch(`http://127.0.0.1:${port}/api/incident/commit`,{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
        ...scenario,incident:{...scenario.incident,reserve:'300'},strategy:'continuity',digest:opts.continuity.digest,
      }),
    });
    assert.equal(altered.status,409,'changing the incident threshold must invalidate its fingerprint');
    assert.equal((await request(port,'/api/state')).state.version,'1');
    const done=await request(port,'/api/incident/commit',{...scenario,strategy:'continuity',digest:opts.continuity.digest});
    assert.equal(done.result.success,true);
    assert.deepEqual([done.state.a,done.state.b,done.state.c],['200','500','100']);
    assert.equal(done.state.version,'2');
    const sameIncident=(await request(port,'/api/incident/assess',{
      ...scenario,expectedVersion:'2',
    })).assessment;
    assert.equal(sameIncident.status,'already_contained');
    assert.equal(sameIncident.options.length,0);
    const stale=await fetch(`http://127.0.0.1:${port}/api/incident/commit`,{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...scenario,strategy:'continuity',digest:opts.continuity.digest}),
    });
    assert.equal(stale.status,409,'cannot replay incident assessment after version change');
    const history=await request(port,'/api/history');
    assert.equal(history.history.length,1);
    assert.equal(history.history[0].operation,'incident');
    assert.equal(history.history[0].strategy,'continuity');
    assert.equal(history.history[0].incident.maximum,'200');
    assert.deepEqual(history.history[0].target,opts.continuity.target);
    assert.match(history.history[0].incidentFingerprint,/^[a-f0-9]{64}$/);
    const exported=await request(port,'/api/history/export');
    assert.equal(exported.transactions.length,1);
    assert.equal(exported.journalEntries.length,2);
    await stop(proc);proc=await startServer(port,auditPath);
    assert.equal((await request(port,'/api/state')).state.version,'1','memory resets between server sessions');
    const restored=await request(port,'/api/history');
    assert.equal(restored.history.length,1,'audit remains intact across restarts');
    assert.equal(restored.audit.verifiedAtStartup,true);
  } finally {if(proc) await stop(proc);rmSync(tmp,{recursive:true,force:true});}
});

test('HTTP incident desk: impossible reserve, unauthorized signer, and incorrect strategy fingerprints submit no transactions', {timeout:45000},async()=>{
  const tmp=mkdtempSync(join(tmpdir(),'covenant-incident-safety-'));
  const auditPath=join(tmp,'audit.jsonl'),port=await freePort();let proc;
  const scenario={incident:{market:'0',maximum:'200',reserve:'200'},expectedVersion:'1',role:'admin'};
  try {
    proc=await startServer(port,auditPath);
    const impossible=(await request(port,'/api/incident/assess',{
      ...scenario,incident:{...scenario.incident,reserve:'950'},
    })).assessment;
    assert.equal(impossible.status,'unreachable');
    assert.equal(impossible.options.length,0);
    const reviewer=(await request(port,'/api/incident/assess',{
      ...scenario,role:'reviewer',
    })).assessment;
    assert.equal(reviewer.options.some(o=>o.status==='unauthorized'),true);
    assert.equal(reviewer.options.some(o=>o.status==='ready'),false);
    const viewerOption=reviewer.options.find(o=>o.status==='unauthorized');
    const wrongSigner=await fetch(`http://127.0.0.1:${port}/api/incident/commit`,{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
        ...scenario,role:'reviewer',strategy:viewerOption.id,digest:viewerOption.digest,
      }),
    });
    assert.equal(wrongSigner.status,409);
    const correct=(await request(port,'/api/incident/assess',scenario)).assessment;
    const preserve=correct.options.find(o=>o.id==='continuity');
    const wrongChoice=await fetch(`http://127.0.0.1:${port}/api/incident/commit`,{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
        ...scenario,strategy:'reserve',digest:preserve.digest,
      }),
    });
    assert.equal(wrongChoice.status,409);
    const history=await request(port,'/api/history');
    assert.equal(history.history.length,0);
    assert.equal((await request(port,'/api/state')).state.version,'1');
  }finally{if(proc)await stop(proc);rmSync(tmp,{recursive:true,force:true});}
});

test('HTTP incident v1.7: Fe attests exposure/reserve/target and audit records independent incident mask', {timeout:45000},async()=>{
  const tmp=mkdtempSync(join(tmpdir(),'covenant-incident-attested-'));
  const auditPath=join(tmp,'audit.jsonl'),port=await freePort();let proc;
  const scenario={incident:{market:'0',maximum:'200',reserve:'200'},expectedVersion:'1',role:'admin'};
  try {
    proc=await startServer(port,auditPath);
    const {assessment}=await request(port,'/api/incident/assess',scenario);
    const eligible=assessment.options.filter(o=>o.status==='ready');
    assert.equal(eligible.length,3);
    for(const item of eligible){
      assert.equal(item.feIncidentMask,0);
      assert.equal(item.feIncidentGoalMatches,true);
      assert.equal(item.feMask,0);
      assert.match(item.feIncidentPreviewSource,/Fe previewIncidentActions/);
    }
    const reserve=eligible.find(o=>o.id==='reserve');
    assert.ok(reserve);
    const done=await request(port,'/api/incident/commit',{...scenario,strategy:'reserve',digest:reserve.digest});
    assert.equal(done.result.success,true);
    assert.deepEqual([done.state.version,done.state.a,done.state.b,done.state.c],['2','200','300','100']);
    const history=(await (await fetch(`http://127.0.0.1:${port}/api/history`)).json()).history;
    assert.equal(history.length,1);
    assert.equal(history[0].feIncidentMask,0);
    assert.equal(history[0].feIncidentGoalMatches,true);
    assert.equal(history[0].incidentEnforcement,'Fe commitIncidentActions()');
    assert.equal(history[0].incidentMetrics.reserve,'400');
    const stale=await fetch(`http://127.0.0.1:${port}/api/incident/commit`,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({...scenario,strategy:'reserve',digest:reserve.digest})});
    assert.equal(stale.status,409);
    const after=(await (await fetch(`http://127.0.0.1:${port}/api/history`)).json()).history;
    assert.equal(after.length,1,'stale incident must not submit another transaction');
  }finally{if(proc)await stop(proc);rmSync(tmp,{recursive:true,force:true});}
});
