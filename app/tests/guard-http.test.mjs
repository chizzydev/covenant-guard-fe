import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..','..');
async function freePort() { return new Promise((ok,fail)=>{
  const s=createServer();s.once('error',fail);s.listen(0,'127.0.0.1',()=>{
    const port=s.address().port;s.close(()=>ok(port));
  });
});}
async function startup(port,auditPath) {
  const proc=spawn(process.execPath,['app/server.mjs'],{
    cwd:root,env:{...process.env,PORT:String(port),COVENANT_AUDIT_PATH:auditPath},
    stdio:['ignore','pipe','pipe'],
  });
  let buffer='';
  const ready=new Promise((ok,fail)=>{
    const timer=setTimeout(()=>fail(Error('GUARD_HTTP_START_TIMEOUT='+buffer)),22000);
    const handle=b=>{
      buffer+=b.toString();
      if(buffer.includes('COVENANT_LOCAL_EVM=READY')&&buffer.includes('GUARD_EVM=READY')) {
        clearTimeout(timer);ok();
      }
    };
    proc.stdout.on('data',handle);proc.stderr.on('data',handle);
    proc.once('error',fail);proc.once('exit',code=>{
      clearTimeout(timer);fail(Error('GUARD_HTTP_EXIT='+code+' '+buffer));
    });
  });
  try {await ready;}catch(e){proc.kill();throw e;}
  return proc;
}
async function req(port,path,data) {
  const base=`http://127.0.0.1:${port}`;
  const response=await fetch(base+path,data===undefined?undefined:{
    method:'POST',headers:{'content-type':'application/json','origin':base},
    body:JSON.stringify(data),
  });
  const payload=await response.json();
  return {status:response.status,payload};
}
async function stop(proc) {
  if(proc.exitCode!==null) return;
  await new Promise(resolveStop=>{
    proc.once('exit',resolveStop);proc.kill();setTimeout(resolveStop,2000).unref();
  });
}

test('P06 same-server full integration: two Fe contracts, real risk lifecycle, baseline workspace preserved',
  {timeout:60000},async()=>{
  const tmp=mkdtempSync(join(tmpdir(),'covenant-guard-http-'));
  const journal=join(tmp,'audit.jsonl');
  const port=await freePort();let proc;
  try {
    proc=await startup(port,journal);
    const base=await req(port,'/api/state');
    assert.equal(base.status,200);
    assert.equal(base.payload.state.version,'1');
    const link=await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(link.status,200);
    assert.match(await link.text(),/guard\.html/);
    const page=await fetch(`http://127.0.0.1:${port}/guard.html`);
    assert.equal(page.status,200);
    assert.match(await page.text(),/Same guard/);
    const initial=await req(port,'/api/guard/state');
    assert.equal(initial.status,200);
    assert.equal(initial.payload.states.allocation.version,'1');
    assert.equal(initial.payload.states.governance.version,'1');
    assert.notEqual(initial.payload.states.allocation.contract,initial.payload.states.governance.contract);
    const preview=await req(port,'/api/guard/preview',{
      domain:'allocation',role:'admin',expectedVersion:'1',x:'350',y:'350',z:'100',
    });
    assert.equal(preview.status,200);
    assert.equal(preview.payload.preview.eligible,true);
    const rejected=await req(port,'/api/guard/commit',{
      domain:'allocation',role:'reviewer',expectedVersion:'1',x:'350',y:'350',z:'100',
    });
    assert.equal(rejected.status,200);
    assert.equal(rejected.payload.result.success,false);
    assert.deepEqual(rejected.payload.after.incident,rejected.payload.before.incident);
    assert.equal(rejected.payload.after.version,'1');
    const unauthorized=await req(port,'/api/guard/activate',{
      domain:'allocation',role:'admin',mode:'progressive',expectedVersion:'1',
      market:'0',maximum:'200',bufferMinimum:'300',
    });
    assert.equal(unauthorized.payload.result.success,false);
    assert.equal(unauthorized.payload.after.version,'1');
    const active=await req(port,'/api/guard/activate',{
      domain:'allocation',role:'guardian',mode:'progressive',expectedVersion:'1',
      market:'0',maximum:'200',bufferMinimum:'300',
    });
    assert.equal(active.payload.result.success,true);
    assert.equal(active.payload.after.incident.phase,1);
    assert.deepEqual(active.payload.after.deficits,{exposure:'200',buffer:'100'});
    const first=await req(port,'/api/guard/commit',{
      domain:'allocation',role:'admin',expectedVersion:'2',x:'300',y:'300',z:'100',
    });
    assert.equal(first.payload.result.success,true);
    assert.deepEqual(first.payload.after.deficits,{exposure:'100',buffer:'0'});
    const trade=await req(port,'/api/guard/commit',{
      domain:'allocation',role:'admin',expectedVersion:'3',x:'250',y:'400',z:'100',
    });
    assert.equal(trade.payload.result.success,false);
    assert.equal(trade.payload.after.version,'3');
    assert.deepEqual(trade.payload.after.deficits,first.payload.after.deficits);
    const finish=await req(port,'/api/guard/commit',{
      domain:'allocation',role:'admin',expectedVersion:'3',x:'200',y:'300',z:'100',
    });
    assert.equal(finish.payload.result.success,true);
    assert.equal(finish.payload.after.incident.phase,2);
    const released=await req(port,'/api/guard/release',{
      domain:'allocation',role:'guardian',expectedVersion:'4',incidentId:'1',
    });
    assert.equal(released.payload.result.success,true);
    assert.equal(released.payload.after.incident.phase,0);
    const governance=await req(port,'/api/guard/activate',{
      domain:'governance',role:'guardian',mode:'atomic',expectedVersion:'1',
      market:'0',maximum:'2',bufferMinimum:'7',x:'2',y:'9',z:'7',
    });
    assert.equal(governance.payload.result.success,true);
    assert.equal(governance.payload.after.incident.phase,2);
    assert.deepEqual(governance.payload.after.deficits,{exposure:'0',buffer:'0'});
    const oldState=await req(port,'/api/state');
    assert.equal(oldState.status,200);
    assert.equal(oldState.payload.state.version,'1','legacy app EVM intentionally separate in P06-R1');
    const history=await req(port,'/api/history');
    assert.equal(history.status,200);
    assert.ok(history.payload.history.filter(x=>x.operation.startsWith('guard_')).length>=8);
    const content=readFileSync(journal,'utf8');
    assert.ok(content.includes('guard_activateRecovery'));
    assert.ok(content.includes('guard_setAllocation'));
    assert.ok(content.includes('guard_activateAtomicRestriction'));
  } finally {
    if(proc) await stop(proc);
    rmSync(tmp,{recursive:true,force:true});
  }
});

test('P06 HTTP rejects malformed input, unexpected roles and cross-origin writes',
  {timeout:45000},async()=>{
  const tmp=mkdtempSync(join(tmpdir(),'covenant-guard-negative-'));
  const port=await freePort();let proc;
  try {
    proc=await startup(port,join(tmp,'audit.jsonl'));
    const badRole=await req(port,'/api/guard/preview',{
      domain:'allocation',role:'superadmin',expectedVersion:'1',x:'0',y:'0',z:'0',
    });
    assert.equal(badRole.status,400);
    const badDecimal=await req(port,'/api/guard/commit',{
      domain:'allocation',role:'admin',expectedVersion:'1',x:'-1',y:'0',z:'0',
    });
    assert.equal(badDecimal.status,400);
    const origin=await fetch(`http://127.0.0.1:${port}/api/guard/commit`,{
      method:'POST',headers:{'content-type':'application/json',origin:'https://attacker.invalid'},
      body:JSON.stringify({domain:'allocation',role:'admin',expectedVersion:'1',x:'200',y:'300',z:'100'}),
    });
    assert.equal(origin.status,403);
    const last=await req(port,'/api/guard/state');
    assert.equal(last.payload.states.allocation.version,'1');
  } finally {
    if(proc) await stop(proc);
    rmSync(tmp,{recursive:true,force:true});
  }
});
