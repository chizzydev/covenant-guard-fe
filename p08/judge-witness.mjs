// A small, independently specified, REAL EVM witness for judges.
// All state values are read from the deployed local Fe contract, never mocked.
import { createEvmSession } from '../p07/evm-transport.mjs';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const actions=[
  {label:'Guardian declares recovery target',method:'activateProgressive',role:'guardian',args:['1','0','200','300']},
  {label:'Operator makes partial progress',method:'commit',role:'admin',args:['2','300','300','100']},
  {label:'Operator tries risk regression (must revert)',method:'commit',role:'admin',args:['3','350','300','100']},
  {label:'Operator completes recovery',method:'commit',role:'admin',args:['3','200','300','100']},
  {label:'Reviewer tries to release incident (must revert)',method:'releaseIncidentBound',role:'reviewer',args:['4','1']},
  {label:'Guardian releases the bound incident',method:'releaseIncidentBound',role:'guardian',args:['4','1']},
];
const env={...process.env};
const oracle=spawnSync(process.env.P07_PYTHON||'python3',[resolve(root,'p07/spec/oracle.py')],{
  cwd:root,input:JSON.stringify({fn:'replay',steps:actions.map(({method,role,args})=>({method,role,args}))}),
  encoding:'utf8',env,maxBuffer:4*1024*1024,
});
if(oracle.status!==0||oracle.error)throw Error(`P08_PYTHON_ORACLE_FAILED: ${oracle.stderr||oracle.error}`);
const expected=JSON.parse(oracle.stdout);
const modelView=(s)=>({version:String(s.version),values:[s.a,s.b,s.c].map(String),
  incident:{phase:String(s.incident.phase),id:String(s.incident.id),market:String(s.incident.market),
  maximum:String(s.incident.maximum),bufferMinimum:String(s.incident.reserveMinimum)},
  deficits:[String(s.deficits.exposure),String(s.deficits.reserve)]});
const observed=[];
const vm=await createEvmSession();
const initial=modelView(await vm.state());
if(JSON.stringify(initial)!==JSON.stringify(expected.initial))throw Error('P08_WITNESS_INITIAL_STATE_DIVERGENCE');
for(const [i,a] of actions.entries()){
  const before=modelView(await vm.state());
  const r=await vm.transact(a.method,a.args,a.role);
  const after=modelView(await vm.state());
  const oracleStep=expected.results[i];
  if(Boolean(r.success)!==Boolean(oracleStep.success)||JSON.stringify(after)!==JSON.stringify(oracleStep.state)||
    (!r.success&&JSON.stringify(before)!==JSON.stringify(after))){
    throw Error(`P08_WITNESS_ORACLE_DIVERGENCE_AT_STEP=${i+1}`);
  }
  observed.push({step:i+1,label:a.label,actor:a.role,method:a.method,args:a.args,
    success:Boolean(r.success),txHash:r.transactionHash||null,gasSpent:String(r.gasSpent??0),
    before,after,oracleOutcome:oracleStep.success});
  console.log(`P08_JUDGE_STEP_${i+1}=${r.success?'ACCEPT':'REJECT'} model=AGREED ${a.label}`);
}
if(observed.filter(x=>x.success).length!==4||observed.filter(x=>!x.success).length!==2)throw Error('P08_WITNESS_UNEXPECTED_COUNTS');
const output={schema:'COVENANT_GUARD_P08_JUDGE_WITNESS_V1',scope:'Local signed EthereumJS EVM using compiled Fe bytecode',
  oracle:'Independent Python p07/spec/oracle.py',initial,steps:observed,final:observed.at(-1).after,
  sourceSha256:{library:createHash('sha256').update((await import('node:fs')).readFileSync(resolve(root,'library/covenant_transition/src/lib.fe'))).digest('hex'),
    flagship:createHash('sha256').update((await import('node:fs')).readFileSync(resolve(root,'consumers/allocation_flagship/src/lib.fe'))).digest('hex')},
  limitations:['Synthetic keys','Disposable local EVM','Not a public transaction','No formal proof','In-process local oracle harness']};
const outDir=resolve(root,'results/p08');mkdirSync(outDir,{recursive:true});
writeFileSync(resolve(outDir,'JUDGE_WITNESS.json'),JSON.stringify(output,null,2));
console.log('P08_JUDGE_WITNESS_REAL_FE_EVM=PASS');
console.log('P08_JUDGE_WITNESS_ORACLE_AGREEMENT=PASS');
console.log('P08_JUDGE_WITNESS_4_ACCEPT_2_REJECT=PASS');
