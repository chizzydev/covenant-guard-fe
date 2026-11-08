import test from 'node:test';
import assert from 'node:assert/strict';
import { createGuardChain } from '../guard-chain.mjs';

const p = (domain, expected, x, y, z, role='admin') => ({
  domain, expected:BigInt(expected),x:BigInt(x),y:BigInt(y),z:BigInt(z),role,
});
const ins = (domain, expected,mode, maximum,bufferMinimum,role='guardian',target=null)=>({
  domain, expected:BigInt(expected),mode,market:0n,maximum:BigInt(maximum),
  bufferMinimum:BigInt(bufferMinimum),role,target,
});
const protectedState = s => ({version:s.version,x:s.x,y:s.y,z:s.z,incident:s.incident,deficits:s.deficits});

test('P06 real EVM deploys two distinct consumers with distinct role addresses',async()=>{
  const runtime=await createGuardChain();
  const states=await runtime.bothStates();
  assert.notEqual(states.allocation.contract,states.governance.contract);
  assert.deepEqual([states.allocation.x,states.allocation.y,states.allocation.z],['400','300','100']);
  assert.deepEqual([states.governance.x,states.governance.y,states.governance.z],['5','9','2']);
  assert.notEqual(states.allocation.operator,states.allocation.guardian);
  assert.equal(states.allocation.operator,states.governance.operator);
  assert.equal(states.governance.guardian,states.allocation.guardian);
  assert.equal(states.allocation.version,'1');
  assert.equal(states.governance.version,'1');
});

test('P06 allocation Fe preview, operator authority and rejected full-state rollback',async()=>{
  const runtime=await createGuardChain();
  const good=p('allocation',1,350,350,100);
  const preview=await runtime.preview(good);
  assert.equal(preview.mask,0);
  assert.equal(preview.eligible,true);
  const wrong=await runtime.preview({...good,role:'reviewer'});
  assert.equal(wrong.authorized,false);
  const prior=protectedState(await runtime.state('allocation'));
  const denied=await runtime.commit({...good,role:'reviewer'});
  assert.equal(denied.success,false);
  assert.deepEqual(protectedState(await runtime.state('allocation')),prior);
  assert.equal((await runtime.commit(good)).success,true);
  assert.equal((await runtime.state('allocation')).version,'2');
  const stale=await runtime.commit(good);
  assert.equal(stale.success,false);
  const invalid=await runtime.commit(p('allocation',2,560,300,100));
  assert.equal(invalid.success,false);
  assert.deepEqual([...(Object.values(protectedState(await runtime.state('allocation'))).slice(0,4))],['2','350','350','100']);
});

test('P06 progressive Fe incident enforces strict vector improvement on every transaction',async()=>{
  const runtime=await createGuardChain();
  const before=protectedState(await runtime.state('allocation'));
  const noGuardian=await runtime.activate(ins('allocation',1,'progressive',200,300,'reviewer'));
  assert.equal(noGuardian.success,false);
  assert.deepEqual(protectedState(await runtime.state('allocation')),before);
  assert.equal((await runtime.activate(ins('allocation',1,'progressive',200,300))).success,true);
  let s=await runtime.state('allocation');
  assert.equal(s.version,'2');
  assert.equal(s.incident.phase,1);
  assert.deepEqual(s.deficits,{exposure:'200',buffer:'100'});
  const noOp=await runtime.commit(p('allocation',2,400,300,100));
  assert.equal(noOp.success,false);
  const partial=await runtime.commit(p('allocation',2,300,300,100));
  assert.equal(partial.success,true);
  s=await runtime.state('allocation');
  assert.deepEqual(s.deficits,{exposure:'100',buffer:'0'});
  const prior=protectedState(s);
  assert.equal((await runtime.commit(p('allocation',3,350,300,100))).success,false);
  assert.equal((await runtime.commit(p('allocation',3,250,400,100))).success,false);
  assert.deepEqual(protectedState(await runtime.state('allocation')),prior);
  const contained=await runtime.commit(p('allocation',3,200,300,100));
  assert.equal(contained.success,true);
  s=await runtime.state('allocation');
  assert.equal(s.version,'4');
  assert.equal(s.incident.phase,2);
  assert.deepEqual(s.deficits,{exposure:'0',buffer:'0'});
  assert.equal((await runtime.commit(p('allocation',4,250,300,100))).success,false);
  assert.equal((await runtime.release({domain:'allocation',expected:4n,incidentId:1n,role:'admin'})).success,false);
  assert.equal((await runtime.release({domain:'allocation',expected:4n,incidentId:2n,role:'guardian'})).success,false);
  assert.equal((await runtime.release({domain:'allocation',expected:4n,incidentId:1n,role:'guardian'})).success,true);
  assert.equal((await runtime.state('allocation')).incident.phase,0);
  assert.equal((await runtime.state('allocation')).version,'5');
});

test('P06 atomic activation either contains all risk immediately or rolls back everything',async()=>{
  const runtime=await createGuardChain();
  const before=protectedState(await runtime.state('allocation'));
  const unsafe=await runtime.activate(ins('allocation',1,'atomic',200,300,'guardian',{
    x:300n,y:300n,z:100n,
  }));
  assert.equal(unsafe.success,false);
  assert.deepEqual(protectedState(await runtime.state('allocation')),before);
  const safe=await runtime.activate(ins('allocation',1,'atomic',200,300,'guardian',{
    x:200n,y:300n,z:100n,
  }));
  assert.equal(safe.success,true);
  const s=await runtime.state('allocation');
  assert.equal(s.version,'2');assert.equal(s.incident.phase,2);
  assert.deepEqual(s.deficits,{exposure:'0',buffer:'0'});
  assert.deepEqual([s.x,s.y,s.z],['200','300','100']);
});

test('P06 governance uses a different Fe policy and a delay-based buffer',async()=>{
  const runtime=await createGuardChain();
  const invalid=await runtime.commit(p('governance',1,10,9,2));
  assert.equal(invalid.success,false);
  assert.equal((await runtime.state('governance')).version,'1');
  const activated=await runtime.activate(ins('governance',1,'progressive',2,7));
  assert.equal(activated.success,true);
  let s=await runtime.state('governance');
  assert.deepEqual(s.deficits,{exposure:'3',buffer:'5'});
  assert.equal((await runtime.commit(p('governance',2,4,9,4))).success,true);
  s=await runtime.state('governance');
  assert.deepEqual(s.deficits,{exposure:'2',buffer:'3'});
  const checkpoint=protectedState(s);
  assert.equal((await runtime.commit(p('governance',3,3,9,3))).success,false);
  assert.deepEqual(protectedState(await runtime.state('governance')),checkpoint);
  assert.equal((await runtime.commit(p('governance',3,2,9,7))).success,true);
  s=await runtime.state('governance');
  assert.equal(s.incident.phase,2);
  assert.deepEqual(s.deficits,{exposure:'0',buffer:'0'});
  assert.equal((await runtime.release({domain:'governance',expected:4n,incidentId:1n,role:'guardian'})).success,true);
  assert.equal((await runtime.state('governance')).version,'5');
});

test('P06 two-field migration is guarded and domain-specific',async()=>{
  const runtime=await createGuardChain();
  const move=await runtime.migrate({domain:'allocation',expected:1n,first:1n,firstValue:350n,second:0n,secondValue:350n,role:'admin'});
  assert.equal(move.success,true);
  let s=await runtime.state('allocation');
  assert.deepEqual([s.version,s.x,s.y,s.z],['2','350','350','100']);
  const stale=await runtime.migrate({domain:'allocation',expected:1n,first:1n,firstValue:350n,second:0n,secondValue:350n,role:'admin'});
  assert.equal(stale.success,false);
  const g=await runtime.migrate({domain:'governance',expected:1n,first:1n,firstValue:4n,second:0n,secondValue:3n,role:'admin'});
  assert.equal(g.success,true);
  s=await runtime.state('governance');
  assert.deepEqual([s.version,s.x,s.y,s.z],['2','3','4','2']);
  await assert.rejects(runtime.migrate({domain:'governance',expected:2n,first:0n,firstValue:3n,second:1n,secondValue:4n,role:'admin'}),/GUARD_GOVERNANCE_MIGRATION_REQUIRES_MEMBERS_THEN_QUORUM/);
});
