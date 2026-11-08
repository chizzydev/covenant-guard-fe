// Optional 1-deletion reducer for FIRST observed model/Fe divergence.
// On failing replay, preserves source trace and recomputes the Python model
// after every attempted deletion; never rewrites oracle expected results.
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {createEvmSession} from './evm-transport.mjs';
const root=resolve(import.meta.dirname,'..');
const src=process.argv[2]||resolve(root,'results','p07','P07_FIRST_DIVERGENCE.json');
const evidence=JSON.parse(readFileSync(src,'utf8'));
const spec=resolve(root,'p07','spec','oracle.py');
const python=process.env.P07_PYTHON||'python';
const norm=s=>JSON.stringify({version:s.version,values:[s.a,s.b,s.c],
  incident:{phase:s.incident.phase,id:s.incident.id,market:s.incident.market,
    maximum:s.incident.maximum,bufferMinimum:s.incident.reserveMinimum},
  deficits:[s.deficits.exposure,s.deficits.reserve]});
async function diverges(commands){
 const p=spawnSync(python,[spec],{encoding:'utf8',input:JSON.stringify({fn:'replay',steps:commands})});
 if(p.status!==0)throw Error('P07_REDUCER_ORACLE_FAILED '+p.stderr);
 const model=JSON.parse(p.stdout),vm=await createEvmSession();
 for(let i=0;i<commands.length;i++){
   const c=commands[i];const before=norm(await vm.state());
   const tx=await vm.transact(c.method,c.args,c.role),after=norm(await vm.state());
   if(tx.success!==model.results[i].success||after!==JSON.stringify(model.results[i].state)||
      (!tx.success&&before!==after))return {index:i,expected:model.results[i],actual:{success:tx.success,state:JSON.parse(after)}};
 }
 return null;
}
let commands=evidence.firstDivergentPrefix;
if(!Array.isArray(commands)||commands.length===0)throw Error('P07_NO_FAILING_PREFIX');
if(!await diverges(commands))throw Error('P07_REDUCER_CANNOT_REPRODUCE_INITIAL');
let trials=0,changed=true;
while(changed&&trials<200){
  changed=false;
  for(let n=0;n<commands.length;n++){
    if(commands.length===1)break;
    const shorter=commands.filter((_,i)=>i!==n);
    trials++;
    const issue=await diverges(shorter);
    if(issue){commands=shorter;changed=true;break;}
    if(trials>=200)break;
  }
}
const final=await diverges(commands);
const output={originalLength:evidence.firstDivergentPrefix.length,remaining:commands.length,
  trials,strictOneMinimal:!changed&&trials<200,commands,firstDivergence:final};
const dest=resolve(root,'results','p07','P07_REDUCED_COUNTEREXAMPLE.json');
writeFileSync(dest,JSON.stringify(output,null,2));
console.log('P07_REDUCED_COUNTEREXAMPLE='+dest);
console.log('P07_REDUCER_1_MINIMAL='+String(output.strictOneMinimal));
