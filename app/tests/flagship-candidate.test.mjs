import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlagshipCandidate } from '../flagship-candidate.mjs';

function exactFields(x){return JSON.stringify(x);}

test('P06-R3 flagship candidate: real Fe ordered action semantics and exact-goal EVM authorization',async()=>{
  const f=await createFlagshipCandidate();
  const initial=await f.state();
  assert.deepEqual([initial.version,initial.a,initial.b,initial.c],['1','400','300','100']);
  const steps=[1n,3n,9n,250n,13n,250n,3n,100n];
  const p=await f.view('previewActions',steps);
  assert.equal(Number(p[0]),0);assert.equal(String(p[1]),'2');
  assert.deepEqual([String(p[7]),String(p[8]),String(p[9]),String(p[10])],['250','450','100','0']);
  assert.deepEqual([String(p[4]),String(p[5]),String(p[6])],['0','2','0']);
  const unauthorized=await f.transact('commitActions',steps,'reviewer');
  assert.equal(unauthorized.success,false);
  assert.equal(exactFields(await f.state()),exactFields(initial),'revert must preserve full state');
  const reversed=await f.view('previewActions',[1n,3n,13n,250n,9n,250n,3n,100n]);
  assert.equal(Number(reversed[0]),256);assert.equal(Number(reversed[10]),21);
  const refused=await f.transact('commitActions',[1n,3n,13n,250n,9n,250n,3n,100n]);
  assert.equal(refused.success,false);
  const wrongGoal=await f.transact('commitGoalActions',[...steps,200n,450n,100n]);
  assert.equal(wrongGoal.success,false);
  assert.equal(exactFields(await f.state()),exactFields(initial));
  const accepted=await f.transact('commitGoalActions',[...steps,250n,450n,100n]);
  assert.equal(accepted.success,true,accepted.error);
  const after=await f.state();
  assert.deepEqual([after.version,after.a,after.b,after.c],['2','250','450','100']);
});

test('P06-R3 flagship candidate: guardian progressive obligation blocks every alternate mutator and bound release',async()=>{
  const f=await createFlagshipCandidate();
  const before=await f.state();
  const denied=await f.transact('activateProgressive',[1n,0n,200n,300n],'admin');
  assert.equal(denied.success,false);
  assert.equal(exactFields(await f.state()),exactFields(before));
  const activated=await f.transact('activateProgressive',[1n,0n,200n,300n],'guardian');
  assert.equal(activated.success,true,activated.error);
  assert.deepEqual((await f.state()).deficits,{exposure:'200',reserve:'100'});
  const noProgress=await f.transact('commitActions',[2n,1n,15n,400n,0n,0n,0n,0n]);
  assert.equal(noProgress.success,false);
  const first=await f.transact('commitActions',[2n,1n,9n,100n,0n,0n,0n,0n]);
  assert.equal(first.success,true,first.error);
  assert.deepEqual((await f.state()).deficits,{exposure:'100',reserve:'0'});
  const snapshot=await f.state();
  const badMigrate=await f.transact('commitMigration',[3n,1n,0n,350n,0n,0n,0n,0n]);
  assert.equal(badMigrate.success,false);
  const badDirect=await f.transact('commit',[3n,350n,300n,100n]);
  assert.equal(badDirect.success,false);
  const badGoal=await f.transact('commitGoalActions',[3n,1n,12n,20n,0n,0n,0n,0n,320n,300n,100n]);
  assert.equal(badGoal.success,false);
  assert.equal(exactFields(await f.state()),exactFields(snapshot));
  const second=await f.transact('commitActions',[3n,1n,9n,100n,0n,0n,0n,0n]);
  assert.equal(second.success,true,second.error);
  assert.equal((await f.state()).incident.phase,'2');
  const regression=await f.transact('commit',[4n,250n,300n,100n]);
  assert.equal(regression.success,false);
  const notGuardian=await f.transact('releaseIncidentBound',[4n,1n],'admin');
  assert.equal(notGuardian.success,false);
  const staleId=await f.transact('releaseIncidentBound',[4n,999n],'guardian');
  assert.equal(staleId.success,false);
  const release=await f.transact('releaseIncidentBound',[4n,1n],'guardian');
  assert.equal(release.success,true,release.error);
  assert.equal((await f.state()).incident.phase,'0');
});
