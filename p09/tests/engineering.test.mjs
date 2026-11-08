import test from 'node:test';
import assert from 'node:assert/strict';
import {createFlagshipCandidate} from '../../app/flagship-candidate.mjs';
import {createFlagshipRuntime} from '../../app/flagship-runtime.mjs';
import {createGuardChain} from '../../app/guard-chain.mjs';
import {createAuditJournal} from '../../app/lib/audit.mjs';
import {mkdirSync,readFileSync,writeFileSync,renameSync,rmSync,existsSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const output=resolve(root,'results/p09');mkdirSync(output,{recursive:true});
const save=(name,value)=>writeFileSync(resolve(output,name+'.json'),JSON.stringify(value,null,2));

test('P09 governance rejects infeasible objectives atomically; valid recovery and ID-bound release',async()=>{
  const g=await createGuardChain();const before=await g.state('governance');const receipts=[];
  for(const mode of ['progressive','atomic'])for(const [maximum,bufferMinimum] of [[0n,2n],[2n,366n],[2n,1n]]){
    const tx=await g.activate({domain:'governance',role:'guardian',expected:1n,mode,market:0n,maximum,bufferMinimum,target:{x:1n,y:9n,z:2n}});
    assert.equal(tx.success,false);assert.deepEqual(await g.state('governance'),before);receipts.push(tx);
  }
  assert.equal((await g.activate({domain:'governance',role:'admin',expected:1n,mode:'progressive',market:0n,maximum:2n,bufferMinimum:7n})).success,false);
  assert.equal((await g.activate({domain:'governance',role:'guardian',expected:1n,mode:'progressive',market:0n,maximum:2n,bufferMinimum:7n})).success,true);
  assert.equal((await g.commit({domain:'governance',role:'admin',expected:2n,x:4n,y:9n,z:4n})).success,true);
  const partial=await g.state('governance');
  for(const target of [{x:5n,y:9n,z:7n},{x:2n,y:9n,z:3n}]){
    assert.equal((await g.commit({domain:'governance',role:'admin',expected:3n,...target})).success,false);
    assert.deepEqual(await g.state('governance'),partial);
  }
  assert.equal((await g.commit({domain:'governance',role:'admin',expected:3n,x:2n,y:9n,z:7n})).success,true);
  for(const [role,id] of [['admin',1n],['guardian',99n]])assert.equal((await g.release({domain:'governance',role,expected:4n,incidentId:id})).success,false);
  assert.equal((await g.release({domain:'governance',role:'guardian',expected:4n,incidentId:1n})).success,true);
  save('governance-feasibility',{before,receipts,partial,final:await g.state('governance')});
});

test('P09 preview separates valid partial progress from full containment',async()=>{
  const f=await createFlagshipRuntime();
  assert.equal((await f.guardActivate({expected:1n,mode:'progressive',market:0n,maximum:200n,bufferMinimum:300n,role:'guardian'})).success,true);
  const request={expectedVersion:2n,steps:[{opcode:9n,amount:100n}],target:{a:'300',b:'300',c:'100'},incident:{market:'0',maximum:'200',reserve:'300'},role:'admin'};
  const p=await f.previewIncidentActions(request);assert.equal(p.validProgress,true);assert.equal(p.fullyContained,false);assert.equal(p.eligible,false);
  assert.equal((await f.transactIncidentActions(request)).success,true);
  save('partial-progress',{preview:p,state:await f.snapshot()});
});

test('P09 complete allocation rollback includes rules and role addresses',async()=>{
  const f=await createFlagshipCandidate();
  const full=async()=>({state:await f.state(),operator:String((await f.view('operator'))[0]),guardian:String((await f.view('guardian'))[0]),snapshot:(await f.view('snapshot')).map(String)});
  await f.transact('activateProgressive',[1,0,200,300],'guardian');const before=await full();
  const attempts=[['commit',[2,450,300,50]],['commitMigration',[2,1,0,450,0,0,0,0]],['commitActions',[2,1,12,50,0,0,0,0]],['commitGoalActions',[2,1,9,100,0,0,0,0,301,300,100]],['commitIncidentActions',[2,1,9,100,0,0,0,0,300,300,100,0,300,300]]];
  for(const [name,args] of attempts){assert.equal((await f.transact(name,args,'admin')).success,false);assert.deepEqual(await full(),before)}
});

async function server(mode='flagship',journal=null){
  const port=await new Promise(r=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const n=s.address().port;s.close(()=>r(n))})});
  journal??=resolve(output,'journal-'+crypto.randomUUID()+'.jsonl');
  const fault=journal+'.fault';
  const child=spawn(process.execPath,['--import','./p09/tests/fault-injector.mjs','app/server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),COVENANT_RUNTIME:mode,COVENANT_AUDIT_PATH:journal,P09_TEST_FAULT_MARKER:fault},stdio:['ignore','pipe','pipe']});
  await new Promise((r,j)=>{let out='';const clock=setTimeout(()=>j(Error(out)),30000);const read=b=>{out+=b;if(out.includes('COVENANT_LOCAL_EVM=READY')){clearTimeout(clock);r()}};child.stdout.on('data',read);child.stderr.on('data',read);child.once('exit',code=>{clearTimeout(clock);j(Error('SERVER_EXIT '+code+out))})});
  return {journal,fault,async req(path,body){const response=await fetch('http://127.0.0.1:'+port+path,body===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,data:await response.json()}},async stop(){if(child.exitCode===null)await new Promise(r=>{child.once('exit',r);child.kill()})}};
}
const activation={domain:'allocation',role:'guardian',expectedVersion:'1',mode:'progressive',market:'0',maximum:'200',bufferMinimum:'300'};
const atomic={...activation,mode:'atomic',x:'200',y:'300',z:'100'};
async function command(s,name,mode){
  if(name==='direct')return ['/api/commit',{expectedVersion:'1',a:'350',b:'350',c:'100',role:'admin'}];
  if(name==='actions')return ['/api/actions/commit',{expectedVersion:'1',steps:[{opcode:'9',amount:'100'}],role:'admin'}];
  if(name==='migration')return ['/api/migration/commit',{expectedVersion:'1',steps:[{market:'0',value:'350'}],role:'admin'}];
  if(name==='planner'){const base={expectedVersion:'1',goal:{kind:'target',a:'350',b:'350',c:'100'},role:'admin'};const p=await s.req('/api/planner/plan',base);return ['/api/planner/commit',{...base,digest:p.data.plan.digest}]}
  if(name==='incident'){
    if(mode!=='legacy')assert.equal((await s.req('/api/guard/activate',activation)).data.result.success,true);
    const base={expectedVersion:mode==='legacy'?'1':'2',incident:{market:'0',maximum:'200',reserve:'300'},role:'admin'};
    const p=await s.req('/api/incident/assess',base);const selected=p.data.assessment.options.find(x=>x.id==='reserve');assert.equal(selected.status,'ready');
    return ['/api/incident/commit',{...base,strategy:'reserve',digest:selected.digest}];
  }
  if(name==='guardCommit')return ['/api/guard/commit',{domain:'allocation',role:'admin',expectedVersion:'1',x:'350',y:'350',z:'100'}];
  if(name==='guardMigrate')return ['/api/guard/migrate',{domain:'allocation',role:'admin',expectedVersion:'1',first:'0',firstValue:'350',second:'1',secondValue:'350'}];
  if(name==='progressive')return ['/api/guard/activate',activation];
  if(name==='atomic')return ['/api/guard/activate',atomic];
  if(name==='release'){assert.equal((await s.req('/api/guard/activate',atomic)).data.result.success,true);return ['/api/guard/release',{domain:'allocation',role:'guardian',expectedVersion:'2',incidentId:'1'}]}
  throw Error(name);
}
for(const mode of ['flagship','legacy'])for(const name of ['direct','actions','migration','planner','incident','guardCommit','guardMigrate','progressive','atomic','release']){
  test(`P09 post-commit fault / ${mode} / ${name}`,{timeout:60000},async()=>{
    const s=await server(mode);try{
      const [path,body]=await command(s,name,mode);
      const prior=(await s.req('/api/history')).data.history;
      writeFileSync(s.fault,'fail');
      const response=await s.req(path,body);assert.equal(response.status,200,JSON.stringify(response));assert.equal(response.data.result.success,true);
      assert.equal(response.data.outcome,'committed_audit_degraded');assert.equal(response.data.retrySafe,false);
      assert.match(response.data.result.transactionHash,/^0x[0-9a-f]{64}$/i);
      const blocked=await s.req(path,body);assert.equal(blocked.status,503);assert.equal(blocked.data.audit.mutationsBlocked,true);
      rmSync(s.fault);
      const recovered=await s.req('/api/audit/reconcile',{});assert.equal(recovered.status,200);assert.equal(recovered.data.audit.health,'healthy');
      const history=(await s.req('/api/history')).data.history;assert.equal(history.length,prior.length+1);
      assert.equal(history.filter(x=>x.txHash===response.data.result.transactionHash).length,1);
      await s.req('/api/audit/reconcile',{});assert.equal((await s.req('/api/history')).data.history.length,history.length);
      const exportPath=resolve(output,'export-'+mode+'-'+name+'.json');writeFileSync(exportPath,JSON.stringify((await s.req('/api/history/export')).data));
      const verified=spawnSync(process.execPath,['p09/verify-journal.mjs',exportPath],{cwd:root,encoding:'utf8'});assert.equal(verified.status,0,verified.stderr);
      save('audit-'+mode+'-'+name,{response,blocked,recovered,history,exportVerification:verified.stdout});
    }finally{await s.stop()}
  });
}

test('P09 restart reconciles a prior session receipt without executing it again',async()=>{
  let s=await server();const journal=s.journal;let hash;
  try{writeFileSync(s.fault,'fail');const r=await s.req('/api/commit',{expectedVersion:'1',a:'350',b:'350',c:'100',role:'admin'});hash=r.data.result.transactionHash;assert.equal(r.data.outcome,'committed_audit_degraded')}finally{await s.stop()}
  rmSync(journal+'.fault');s=await server('flagship',journal);
  try{assert.equal((await s.req('/api/state')).data.state.version,'1');assert.equal((await s.req('/api/audit/status')).data.audit.mutationsBlocked,true);
    assert.equal((await s.req('/api/audit/reconcile',{})).status,200);const h=(await s.req('/api/history')).data.history;assert.equal(h.filter(x=>x.txHash===hash).length,1);
    assert.equal((await s.req('/api/state')).data.state.version,'1');save('restart-recovery',h);
  }finally{await s.stop()}
});

test('P09 unknown restart outcome needs explicit acknowledgement; recovery refuses tampering',async()=>{
  const path=resolve(output,'unknown-'+crypto.randomUUID()+'.jsonl');let a=createAuditJournal(path,{sessionId:'old'});
  await assert.rejects(()=>a.runMutation(async()=>{throw Error('simulated interruption before receipt recording')}));
  a=createAuditJournal(path,{sessionId:'new'});assert.throws(()=>a.reconcile(),/EXPLICIT_ACK/);
  assert.throws(()=>a.reconcile({acknowledgeUnknownSession:'wrong'}),/EXPLICIT_ACK/);
  assert.equal(a.reconcile({acknowledgeUnknownSession:'old'}).previousOutcome,'unknown');assert.equal(a.list().length,0);
  const content=readFileSync(path,'utf8');writeFileSync(path,content.replace('local EVM','forged EVM'));
  assert.throws(()=>createAuditJournal(path),/INTEGRITY_FAILURE/);
});


test('P09 finite direct-transition sweep from every valid grid initial state',async()=>{
  const result=spawnSync(process.env.P07_PYTHON||(process.platform==='win32'?'python':'python3'),['p09/sweep.py'],{cwd:root,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  const groups=JSON.parse(result.stdout);let previews=0;
  for(const group of groups){const vm=await createFlagshipCandidate();for(const step of group.setup)assert.equal((await vm.transact(step.method,step.args,step.role)).success,true);
    const before=await vm.state();assert.deepEqual([before.a,before.b,before.c],group.expected.values);assert.equal(before.version,group.expected.version);assert.equal(before.incident.phase,group.expected.incident.phase);
    for(const probe of group.probes){const p=await vm.view('preview',probe.args,'admin');assert.equal(p[0]===0n,probe.allowed,JSON.stringify({group,probe}));previews++}
    assert.deepEqual(await vm.state(),before);
  }
  save('finite-multistart',{grid:[0,100,200],validInitialStates:groups.length/3,groups:groups.length,previews,scope:'All selected valid initial states and selected direct targets; static EVM execution, not universal proof.'});
});

test('P09 partial append repair is exact; unexpected suffix refuses reconciliation',async()=>{
  const s=await server();try{
    writeFileSync(s.fault,'partial');const response=await s.req('/api/commit',{expectedVersion:'1',a:'350',b:'350',c:'100',role:'admin'});assert.equal(response.data.outcome,'committed_audit_degraded');
    const validPartial=readFileSync(s.journal);writeFileSync(s.journal,Buffer.concat([validPartial,Buffer.from('tampered')]));
    assert.equal((await s.req('/api/audit/reconcile',{})).status,503);assert.equal((await s.req('/api/audit/status')).data.audit.mutationsBlocked,true);
    writeFileSync(s.journal,validPartial);rmSync(s.fault);assert.equal((await s.req('/api/audit/reconcile',{})).status,200);
    const h=(await s.req('/api/history')).data.history;assert.equal(h.filter(x=>x.txHash===response.data.result.transactionHash).length,1);
  }finally{await s.stop()}
});
