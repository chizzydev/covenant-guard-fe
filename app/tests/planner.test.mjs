import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveTarget, candidatePlans, planFromFe, fingerprint } from '../lib/planner.mjs';
const state={version:'1',a:'400',b:'300',c:'100',inputCeiling:'1000000'};
const target={kind:'target',a:'250',b:'450',c:'100'};
const shift={kind:'shift',source:'0',destination:'1',quantity:'150'};

test('planner derives a one-operation alternative to the three-step preset',()=>{
  const t=deriveTarget(state,target);
  const plans=candidatePlans(state,target,t);
  assert.deepEqual(plans,[[{opcode:'1',amount:'150'}]]);
  assert.deepEqual(deriveTarget(state,shift).map(String),['250','450','100']);
});

test('planner recalculates from a changed version rather than replaying v1 values',()=>{
  const later={...state,version:'2',a:'250',b:'450',c:'100'};
  const future={...shift,quantity:'50'};
  const t=deriveTarget(later,future);
  assert.deepEqual(t.map(String),['200','500','100']);
  assert.deepEqual(candidatePlans(later,future,t),[[{opcode:'1',amount:'50'}]]);
  assert.deepEqual(deriveTarget(later,{...shift,quantity:'300'}).map(String),['-50','750','100']);
});

test('goal plan fingerprint binds goal, state version, exact target and ordered steps',()=>{
  const input={goal:target,expectedVersion:'1',target:{a:'250',b:'450',c:'100'},steps:[{opcode:'1',amount:'150'}]};
  const a=fingerprint(input);
  assert.match(a,/^[a-f0-9]{64}$/);
  assert.notEqual(a,fingerprint({...input,expectedVersion:'2'}));
  assert.notEqual(a,fingerprint({...input,target:{a:'250',b:'450',c:'101'}}));
  assert.notEqual(a,fingerprint({...input,steps:[{opcode:'9',amount:'150'},{opcode:'13',amount:'150'}]}));
});

test('planner uses Fe static verdict rather than a locally invented policy decision',async()=>{
  let calls=0;
  const preview=async ({steps,role})=>{
    calls++;
    assert.deepEqual(steps,[{opcode:'1',amount:'150'}]);
    return {mask:0,operationError:0,authorized:role==='admin',final:{a:'250',b:'450',c:'100'},stageMasks:[0]};
  };
  const ready=await planFromFe({state,goal:target,role:'admin',previewActions:preview});
  assert.equal(ready.status,'ready');
  assert.equal(ready.goalMatches,true);
  assert.equal(ready.steps.length,1);
  const reviewer=await planFromFe({state,goal:target,role:'reviewer',previewActions:preview});
  assert.equal(reviewer.status,'unauthorized');
  assert.equal(calls,2);
  const impossible=await planFromFe({state,goal:{...shift,quantity:'500'},role:'admin',previewActions:async()=>({
    mask:64,operationError:20,authorized:true,final:{a:'400',b:'300',c:'100'},stageMasks:[0],
  })});
  assert.equal(impossible.status,'infeasible');
  assert.equal(impossible.evaluated,1);
  assert.equal(impossible.preview.operationError,20);
});

test('planner cannot claim success when Fe rejects the final policy',async()=>{
  const banned={kind:'target',a:'150',b:'550',c:'100'};
  const plan=await planFromFe({state,goal:banned,role:'admin',previewActions:async()=>({
    mask:2,operationError:0,authorized:true,final:{a:'150',b:'550',c:'100'},stageMasks:[2],
  })});
  assert.equal(plan.status,'infeasible');
  assert.match(plan.reason,/market ceiling/i);
});

test('planner tries another order when Fe rejects the first candidate',async()=>{
  const goal={kind:'target',a:'350',b:'350',c:'150'};
  let n=0;
  const plan=await planFromFe({state,goal,role:'admin',previewActions:async({steps})=>{
    n++;
    const accepted=Number(steps[0].opcode)>=12;
    return accepted
      ?{mask:0,operationError:0,authorized:true,final:{a:'350',b:'350',c:'150'},stageMasks:[0,0]}
      :{mask:64,operationError:20,authorized:true,final:{a:'400',b:'300',c:'100'},stageMasks:[0,0]};
  }});
  assert.equal(n,2);
  assert.equal(plan.status,'ready');
  assert.equal(plan.steps.length,2);
  assert.equal(Number(plan.steps[0].opcode)>=12,true);
});
