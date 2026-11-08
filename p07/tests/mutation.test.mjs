// P07 compiler-mutant controls: these are actual mutated Fe source builds.
// A mutant is "detected" only if its compiled EVM behavior differs from the
// independent Python oracle for the specified security-sensitive sequence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createEvmSession} from '../evm-transport.mjs';
const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const evidence=resolve(root,'results','p07');
mkdirSync(evidence,{recursive:true});
const manifest=JSON.parse(readFileSync(resolve(evidence,'mutation-manifest.json'),'utf8'));
assert.equal(manifest.schema,'P07_COMPILER_MUTANTS_V1');
assert.equal(manifest.mutants.length,8);
const PY=process.env.P07_PYTHON||'python';
const SCENARIOS={
  authority:[
    {method:'commit',role:'reviewer',args:['1','350','350','100']},
  ],
  revision:[
    {method:'commit',role:'admin',args:['0','350','350','100']},
  ],
  incident_boundary:[
    {method:'activateProgressive',role:'guardian',args:['1','0','200','300']},
    {method:'commit',role:'admin',args:['2','400','300','100']},
  ],
  phase_finalization:[
    {method:'activateProgressive',role:'guardian',args:['1','0','200','300']},
    {method:'commitActions',role:'admin',args:['2','1','9','200','0','0','0','0']},
  ],
  permanent_policy:[
    {method:'commit',role:'admin',args:['1','550','300','100']},
  ],
  exact_goal:[
    {method:'commitGoalActions',role:'admin',args:['1','1','9','100','0','0','0','0','350','300','100']},
  ],
  guardian_release:[
    {method:'activateProgressive',role:'guardian',args:['1','0','500','100']},
    {method:'releaseIncidentBound',role:'reviewer',args:['2','1']},
  ],
  self_move:[
    {method:'commitActions',role:'admin',args:['1','1','0','100','0','0','0','0']},
  ],
};
function oracle(commands){
  const p=spawnSync(PY,[resolve(root,'p07','spec','oracle.py')],{
    input:JSON.stringify({fn:'replay',steps:commands}),encoding:'utf8',maxBuffer:1024*1024,
  });
  if(p.status!==0||p.error)throw Error('P07_MUTANT_ORACLE_FAILED:'+(p.stderr||p.error));
  return JSON.parse(p.stdout);
}
function modelView(s){return {version:String(s.version),values:[s.a,s.b,s.c].map(String),
  incident:{phase:String(s.incident.phase),id:String(s.incident.id),market:String(s.incident.market),
    maximum:String(s.incident.maximum),bufferMinimum:String(s.incident.reserveMinimum)},
  deficits:[String(s.deficits.exposure),String(s.deficits.reserve)]};}
async function run(vm,commands){
  const results=[];
  for(const command of commands){
    const before=modelView(await vm.state());
    const tx=await vm.transact(command.method,command.args,command.role);
    const after=modelView(await vm.state());
    results.push({success:tx.success,before,after,gasSpent:tx.gasSpent,txHash:tx.transactionHash});
  }
  return results;
}
for(const mutant of manifest.mutants){
  test(`P07 compiled Fe mutation killed: ${mutant.name}`,{timeout:100000},async()=>{
    const commands=SCENARIOS[mutant.name];
    assert.ok(commands&&commands.length>0);
    const reference=oracle(commands);
    const baseline=await run(await createEvmSession(),commands);
    const variant=await run(await createEvmSession(mutant.artifactPrefix),commands);
    // Normal compiler output must agree with the independent oracle on every step.
    for(const [index,expected] of reference.results.entries()){
      assert.equal(baseline[index].success,expected.success,
        `P07_BASELINE_ORACLE_REJECT=${mutant.name}/${index}`);
      assert.deepEqual(baseline[index].after,expected.state,
        `P07_BASELINE_ORACLE_STATE=${mutant.name}/${index}`);
      if(!baseline[index].success){
        assert.deepEqual(baseline[index].before,baseline[index].after,'BASELINE_ROLLBACK_FAILURE');
      }
    }
    // The mutation must NOT corrupt setup behavior; only the targeted operation
    // may diverge. This avoids accidental test positives from unrelated damage.
    for(let i=0;i<commands.length-1;i++){
      assert.equal(variant[i].success,reference.results[i].success,
        `P07_MUTANT_SETUP_OUTCOME_DRIFT=${mutant.name}/${i}`);
      assert.deepEqual(variant[i].after,reference.results[i].state,
        `P07_MUTANT_SETUP_STATE_DRIFT=${mutant.name}/${i}`);
    }
    // A deliberate real-source mutant must produce an observable wrong outcome.
    const divergence=variant.findIndex((event,i)=>
      event.success!==reference.results[i].success||
      JSON.stringify(event.after)!==JSON.stringify(reference.results[i].state));
    const detected=divergence>=0;
    writeFileSync(resolve(evidence,`mutant-${mutant.name}.json`),JSON.stringify({
      mutant,detected,firstDivergence:divergence,commands,
      oracle:reference,normal:baseline,mutated:variant,
      trust:'LOCAL_SIGNED_EVM_FE_MUTATION_ONLY',
    },null,2));
    assert.equal(divergence,commands.length-1,
      `P07_MUTANT_SURVIVED_OR_EARLY_DRIFT=${mutant.name}:first=${divergence}`);
    console.log(`P07_MUTANT_${mutant.name.toUpperCase()}=KILLED`);
  });
}
