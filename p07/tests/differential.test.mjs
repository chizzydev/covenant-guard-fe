// P07: independent Python safety oracle vs original compiled Fe EVM bytecode.
// DO NOT import application planner/runtime for permission or state predictions.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createEvmSession} from '../evm-transport.mjs';
const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const PY=process.env.P07_PYTHON||'python';
const Spec=resolve(root,'p07','spec');
const Evidence=resolve(root,'results','p07');
mkdirSync(Evidence,{recursive:true});
function python(file,args=[],input=null){
  const p=spawnSync(PY,[resolve(Spec,file),...args],{cwd:Spec,encoding:'utf8',input:input===null?undefined:JSON.stringify(input),maxBuffer:32*1024*1024});
  if(p.error||p.status!==0)throw Error('P07_PYTHON_FAILED:'+file+':'+(p.error||p.stderr));
  return JSON.parse(p.stdout);
}
function stable(obj){return JSON.stringify(obj);}
function observed(s){return {version:String(s.version),values:[s.a,s.b,s.c].map(String),
  incident:{phase:String(s.incident.phase),id:String(s.incident.id),market:String(s.incident.market),
    maximum:String(s.incident.maximum),bufferMinimum:String(s.incident.reserveMinimum)},
  deficits:[String(s.deficits.exposure),String(s.deficits.reserve)]};}
async function fire(vm,step){return vm.transact(step.method,step.args,step.role);}
async function replayOne(vm,item,context){
  const before=observed(await vm.state());
  const tx=await fire(vm,item.command);
  const after=observed(await vm.state());
  const expected=item.expected;
  if(Boolean(tx.success)!==Boolean(expected.success)||stable(after)!==stable(expected.state)||
    (!tx.success&&stable(before)!==stable(after))){
    throw Object.assign(Error(`P07_ORACLE_EVM_DIVERGENCE ${context}: tx=${tx.success}/${expected.success}`),
      {context,command:item.command,expected,actual:{success:tx.success,state:after,error:tx.error},before});
  }
  return {success:tx.success,gas:Number(tx.gasSpent)};
}
function saveMismatch(e,seed,commands){
  const evidence={seed,context:e.context,command:e.command,expected:e.expected,actual:e.actual,
    before:e.before,firstDivergentPrefix:commands};
  writeFileSync(resolve(Evidence,'P07_FIRST_DIVERGENCE.json'),JSON.stringify(evidence,null,2));
}
async function replayTrace(seed,count=100){
  const bundle=python('traces.py',['--seed',String(seed),'--count',String(count)]);
  assert.equal(bundle.schema,'COVENANT_GUARD_P07_ORACLE_V1');
  assert.equal(bundle.steps.length,count);
  assert.ok(bundle.accepts>=8&&bundle.rejects>=8,'P07_TRACE_NOT_MIXED');
  const vm=await createEvmSession();
  assert.deepEqual(observed(await vm.state()),bundle.initial);
  let successes=0,reverts=0,totalGas=0;
  const history=[];
  for(const item of bundle.steps){
    history.push(item.command);
    try{
      const result=await replayOne(vm,item,`seed=${seed} step=${item.ordinal}`);
      successes+=Number(result.success);reverts+=Number(!result.success);totalGas+=result.gas;
    }catch(e){saveMismatch(e,seed,history);throw e;}
  }
  assert.equal(successes,bundle.accepts);assert.equal(reverts,bundle.rejects);
  assert.deepEqual(observed(await vm.state()),bundle.final);
  return {seed,count,successes,reverts,totalGas,provenance:vm.provenance};
}
for (const seed of [701,1701,2701]){
  test(`P07 raw-Fe EVM differential seeded replay ${seed}`,{timeout:180000},async()=>{
    const r=await replayTrace(seed,100);
    writeFileSync(resolve(Evidence,`seed-${seed}.json`),JSON.stringify(r,null,2));
    console.log(`P07_SEEDED_DIFF_${seed}=PASS accepts=${r.successes} rejects=${r.reverts}`);
  });
}
test('P07 exhaustive writer x actor x phase signed EVM matrix (72 cells)',{timeout:240000},async()=>{
  const matrix=python('matrix.py');
  assert.equal(matrix.entries.length,72);
  const outcomes=[];
  for(const [index,item] of matrix.entries.entries()){
    const vm=await createEvmSession();
    for(const setup of item.setup){
      const tx=await vm.transact(setup.method,setup.args,setup.role);
      assert.equal(tx.success,true,'matrix setup failed:'+stable(item));
    }
    assert.deepEqual(observed(await vm.state()),item.before);
    try{
      const r=await replayOne(vm,item,`matrix index=${index} phase=${item.phase} actor=${item.role} method=${item.method}`);
      outcomes.push({...item,actualSuccess:r.success});
    }catch(e){saveMismatch(e,'matrix',[...item.setup,item.command]);throw e;}
  }
  const successes=outcomes.filter(x=>x.actualSuccess).length;
  writeFileSync(resolve(Evidence,'actor-selector-phase-matrix.json'),JSON.stringify({cells:72,successes,failed:72-successes,outcomes},null,2));
  console.log(`P07_FULL_72_CELL_ABI_MATRIX=PASS accepted=${successes} rejected=${72-successes}`);
});
test('P07 bounded finite-domain static call (432 Fe previews, no mutation)',{timeout:180000},async()=>{
  const valuesA=[0,100,200,300,400,550];
  const valuesB=[0,100,200,300,450,500];
  const valuesC=[0,100,200,350];
  // An independent Python oracle computes the expected availability for every
  // requested direct transition from each fixed live phase; not Fe/JS masks.
  let count=0;const records=[];
  for(const phase of [0,1,2]){
    const vm=await createEvmSession();
    if(phase){
      const tx=await vm.transact('activateProgressive',
        ['1','0',phase===1?'200':'500',phase===1?'300':'100'],'guardian');
      assert.equal(tx.success,true);
    }
    const base=observed(await vm.state());
    const requests=[];
    for(const a of valuesA)for(const b of valuesB)for(const c of valuesC){
      requests.push({method:'commit',role:'admin',args:[base.version,String(a),String(b),String(c)]});
    }
    const model=python('oracle.py',[],{fn:'replay',steps:[]}); // bridge smoke check of zero-length replay
    assert.ok(model.initial);
    // Run each isolated Python prediction from same phase via phase setup and
    // direct proposal; Python script performs batched, non-mutating predictions.
    const pred=python('finite.py',[],{phase,requests});
    assert.equal(pred.accepts.length,requests.length);
    for(let i=0;i<requests.length;i++){
      const r=requests[i];
      const got=await vm.view('preview',r.args);
      const allowed=BigInt(got[0])===0n;
      assert.equal(allowed,pred.accepts[i],`P07_FINITE_DIVERGENCE phase=${phase} proposal=${r.args}`);
      count++;
    }
    assert.deepEqual(observed(await vm.state()),base,'P07_READ_ONLY_PREVIEWS_CHANGED_STATE');
    records.push({phase,cases:requests.length,allowed:pred.accepts.filter(Boolean).length});
  }
  assert.equal(count,432);
  writeFileSync(resolve(Evidence,'finite-domain.json'),JSON.stringify({total:count,records},null,2));
  console.log('P07_FINITE_DOMAIN_432_PREVIEWS=PASS');
});
