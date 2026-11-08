import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';import {resolve} from 'node:path';
import {createEvmSession} from '../../p07/evm-transport.mjs';
const root=resolve(import.meta.dirname,'../..');
const mutants=JSON.parse(readFileSync(resolve(root,'results/p09/extra-mutants.json'),'utf8'));
const scenarios={
 incident_id:[['activateProgressive',[1,0,500,100],'guardian'],['releaseIncidentBound',[2,99],'guardian']],
 exposure_dimension:[['activateProgressive',[1,0,200,300],'guardian'],['commit',[2,450,225,25],'admin']],
 buffer_dimension:[['activateProgressive',[1,0,200,300],'guardian'],['commit',[2,300,500,100],'admin']],
};
for(const m of mutants)test('P09 compiled mutation detected: '+m.name,async()=>{
 const normal=await createEvmSession(),variant=await createEvmSession(m.artifactPrefix);let observed=[];
 for(const [i,[name,args,role]]of scenarios[m.name].entries()){
  const before=await normal.state();const a=await normal.transact(name,args,role),b=await variant.transact(name,args,role);
  if(i===0){assert.equal(a.success,true);assert.equal(b.success,true);assert.deepEqual(await normal.state(),await variant.state())}
  else{assert.equal(a.success,false);assert.deepEqual(await normal.state(),before);assert.equal(b.success,true)}
  observed.push({method:name,args,baseline:a,mutant:b,normalState:await normal.state(),mutatedState:await variant.state()});
 }
 writeFileSync(resolve(root,'results/p09/mutant-'+m.name+'.json'),JSON.stringify(observed,null,2));
});
