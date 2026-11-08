import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalChain } from '../chain.mjs';

const p = (expectedVersion, a, b, c) => ({ expectedVersion: BigInt(expectedVersion), a: BigInt(a), b: BigInt(b), c: BigInt(c) });

test('real Fe EVM execution: preview and commit agree, rejects unauthorized and stale writes', async () => {
  const chain = await createLocalChain();
  const start = await chain.snapshot();
  assert.equal(start.version, '1');
  assert.equal(start.inputCeiling, '1000000');
  assert.equal(start.pairedMultiplier, '2');
  assert.deepEqual([start.a, start.b, start.c], ['400','300','100']);

  const proposal = p(1, 350, 350, 150);
  assert.deepEqual(await chain.preview(proposal), {
    mask: 0, allowed: true, authorized: true, eligible: true, role: 'admin', nextVersion: '2', total: '850', remaining: '150',
    from: 'Fe EVM execution (static call)',
  });
  assert.equal((await chain.snapshot()).version, '1', 'preview must be read-only');

  const reviewerPreview = await chain.preview({ ...proposal, role: 'reviewer' });
  assert.equal(reviewerPreview.allowed, true, 'proposal remains valid');
  assert.equal(reviewerPreview.authorized, false, 'Fe canCommit denies reviewer');
  assert.equal(reviewerPreview.eligible, false, 'policy validity is not authorization');
  const rejected = await chain.transact({ ...proposal, role: 'reviewer' });
  assert.match(rejected.transactionHash, /^0x[a-fA-F0-9]{64}$/);
  assert.match(rejected.sender, /^0x[a-fA-F0-9]{40}$/);
  assert.equal(rejected.success, false, 'reviewer must be unauthorized');
  assert.equal((await chain.snapshot()).version, '1');

  const committed = await chain.transact({ ...proposal, role: 'admin' });
  assert.equal(committed.success, true);
  assert.match(committed.transactionHash, /^0x[a-fA-F0-9]{64}$/);
  assert.notEqual(committed.transactionHash, rejected.transactionHash);
  assert.deepEqual([...(Object.values(await chain.snapshot())).slice(0,4)], ['2','350','350','150']);

  const stale = await chain.preview(proposal);
  assert.equal(stale.mask, 16);
  assert.equal((await chain.transact({ ...proposal, role: 'admin' })).success, false);
  assert.equal((await chain.snapshot()).version, '2');

  assert.equal((await chain.preview(p(2,500,100,100))).mask, 8);
  assert.equal((await chain.transact({ ...p(2,500,100,100), role: 'admin' })).success, false);
  assert.equal((await chain.snapshot()).version, '2');
});

const migrate = (expectedVersion, steps, role='admin') => ({
  expectedVersion: BigInt(expectedVersion),
  role,
  steps: steps.map(([market,value])=>({market:BigInt(market),value:BigInt(value)})),
});

test('Fe atomic migration: unsafe intermediate states, safe final commitment, full rollback, stale and unauthorized', async () => {
  const chain = await createLocalChain();
  const safe = migrate(1,[[0,550],[1,200],[0,350]]);
  const pre = await chain.previewMigration(safe);
  assert.deepEqual(pre.stageMasks,[4,8,0]);
  assert.equal(pre.mask,0);
  assert.equal(pre.eligible,true);
  assert.deepEqual(pre.final,{a:'350',b:'200',c:'100'});
  assert.equal(pre.nextVersion,'2');
  assert.equal(pre.total,'650');
  assert.equal((await chain.snapshot()).version,'1','preview must not write storage');

  const badEnding = migrate(1,[[0,550],[1,200],[0,500]]);
  const rejectedPreview = await chain.previewMigration(badEnding);
  assert.deepEqual(rejectedPreview.stageMasks,[4,8,8]);
  assert.equal(rejectedPreview.mask,8);
  assert.equal((await chain.transactMigration(badEnding)).success,false);
  assert.deepEqual([...(Object.values(await chain.snapshot())).slice(0,4)], ['1','400','300','100']);

  const unauthorized = await chain.previewMigration({...safe,role:'reviewer'});
  assert.equal(unauthorized.allowed,true);
  assert.equal(unauthorized.authorized,false);
  assert.equal((await chain.transactMigration({...safe,role:'reviewer'})).success,false);
  assert.equal((await chain.snapshot()).version,'1');

  const committed = await chain.transactMigration(safe);
  assert.equal(committed.success,true);
  assert.match(committed.transactionHash,/^0x[0-9a-f]{64}$/i);
  assert.deepEqual([...(Object.values(await chain.snapshot())).slice(0,4)], ['2','350','200','100']);
  assert.equal((await chain.previewMigration(safe)).mask,16);
  assert.equal((await chain.transactMigration(safe)).success,false);
  assert.equal((await chain.snapshot()).version,'2');
});

const actions = (expectedVersion, pairs, role='admin') => ({
  expectedVersion:BigInt(expectedVersion), role,
  steps:pairs.map(([opcode,amount])=>({opcode:BigInt(opcode),amount:BigInt(amount)})),
});

test('Fe semantic operations: strict order, intermediate cap violation, final commit, rollback and version protection', async () => {
  const chain = await createLocalChain();
  const safe = actions(1,[[9,250],[13,250],[3,100]]);
  const preview = await chain.previewActions(safe);
  assert.equal(preview.mask,0);
  assert.equal(preview.operationError,0);
  assert.deepEqual(preview.stageMasks,[0,2,0]);
  assert.deepEqual(preview.final,{a:'250',b:'450',c:'100'});
  assert.equal(preview.eligible,true);
  assert.equal((await chain.snapshot()).version,'1');

  const swapped = actions(1,[[13,250],[9,250],[3,100]]);
  const badOrder = await chain.previewActions(swapped);
  assert.equal(badOrder.mask,64,'Fe precondition flag');
  assert.equal(badOrder.operationError,21,'step 1: insufficient unallocated budget');
  assert.deepEqual([badOrder.final.a,badOrder.final.b,badOrder.final.c],['400','300','100']);
  assert.equal((await chain.transactActions(swapped)).success,false);
  assert.equal((await chain.snapshot()).version,'1');

  const unsafe = actions(1,[[9,250],[13,250],[16,550]]);
  const badFinal = await chain.previewActions(unsafe);
  assert.equal(badFinal.operationError,0,'all instructions themselves are valid');
  assert.equal(badFinal.mask,2,'Fe final-state cap rejection');
  assert.deepEqual(badFinal.stageMasks,[0,2,2]);
  assert.equal((await chain.transactActions(unsafe)).success,false);
  assert.equal((await chain.snapshot()).version,'1');

  assert.equal((await chain.previewActions({...safe,role:'reviewer'})).authorized,false);
  assert.equal((await chain.transactActions({...safe,role:'reviewer'})).success,false);
  assert.equal((await chain.snapshot()).version,'1');

  const committed = await chain.transactActions(safe);
  assert.equal(committed.success,true);
  assert.match(committed.transactionHash,/^0x[0-9a-f]{64}$/i);
  assert.ok(BigInt(committed.gasSpent)>0n);
  const after = await chain.snapshot();
  assert.deepEqual([after.version,after.a,after.b,after.c],['2','250','450','100']);
  // Isolate a stale version from other policy errors: this condition checks
  // the already-committed Core allocation and is otherwise harmless at v2.
  const staleOnly = actions(1,[[15,250]]);
  const stalePreview = await chain.previewActions(staleOnly);
  assert.equal(stalePreview.operationError,0);
  assert.deepEqual(stalePreview.stageMasks,[0]);
  assert.equal(stalePreview.mask,16,'only the optimistic version guard fails');
  assert.equal((await chain.transactActions(staleOnly)).success,false);

  // Replaying the earlier operation sequence from v2 produces a different
  // candidate (100/600/100). In addition to the stale-version bit (16),
  // Supporting exceeds its market cap (2): both independent flags are valid.
  const replay = await chain.previewActions(safe);
  assert.equal(replay.operationError,0);
  assert.deepEqual(replay.stageMasks,[0,2,2]);
  assert.deepEqual(replay.final,{a:'100',b:'600',c:'100'});
  assert.equal(replay.mask,18,'stale version (16) plus market-cap breach (2)');
  assert.equal((await chain.transactActions(safe)).success,false);
  const unchanged = await chain.snapshot();
  assert.deepEqual([unchanged.version,unchanged.a,unchanged.b,unchanged.c],['2','250','450','100']);
});

test('Fe semantic operations: conditional execution cares about order', async () => {
  const chain=await createLocalChain();
  const wrong = actions(1,[[1,50],[15,400]]);
  const p = await chain.previewActions(wrong);
  assert.equal(p.operationError,38,'step two checks current Core, not initial Core');
  assert.equal(p.mask,64);
  assert.deepEqual([p.final.a,p.final.b,p.final.c],['350','350','100']);
  assert.equal((await chain.transactActions(wrong)).success,false);
  const right=actions(1,[[15,400],[1,50],[15,350]]);
  const success=await chain.previewActions(right);
  assert.equal(success.operationError,0);
  assert.equal(success.mask,0);
  assert.deepEqual(success.stageMasks,[0,0,0]);
  assert.equal((await chain.transactActions(right)).success,true);
  assert.equal((await chain.snapshot()).version,'2');
});

test('Fe goal-attested actions reject wrong target, reject unsafe state, and accept live follow-up',async()=>{
  const chain=await createLocalChain();
  const first=actions(1,[[1,150]]);
  const preview=await chain.previewActions(first);
  assert.equal(preview.mask,0);
  assert.deepEqual(preview.final,{a:'250',b:'450',c:'100'});
  const mismatch=await chain.transactGoalActions({...first,target:{a:'250',b:'450',c:'101'}});
  assert.equal(mismatch.success,false,'Fe must independently reject a false declared target');
  assert.equal((await chain.snapshot()).version,'1');
  const unsafe=await chain.transactGoalActions({...actions(1,[[1,250]]),target:{a:'150',b:'550',c:'100'}});
  assert.equal(unsafe.success,false,'final Fe policy still applies');
  assert.equal((await chain.snapshot()).version,'1');
  const reviewer=await chain.transactGoalActions({...first,role:'reviewer',target:preview.final});
  assert.equal(reviewer.success,false,'goal cannot bypass authorization');
  const accepted=await chain.transactGoalActions({...first,target:preview.final});
  assert.equal(accepted.success,true);
  assert.deepEqual([...(Object.values(await chain.snapshot())).slice(0,4)],['2','250','450','100']);
  const follow=actions(2,[[1,50]]);
  const final=await chain.previewActions(follow);
  assert.deepEqual(final.final,{a:'200',b:'500',c:'100'});
  const next=await chain.transactGoalActions({...follow,target:final.final});
  assert.equal(next.success,true);
  assert.deepEqual([...(Object.values(await chain.snapshot())).slice(0,4)],['3','200','500','100']);
  assert.equal((await chain.transactGoalActions({...follow,target:final.final})).success,false,'stale v2 must fail');
});

// v1.7: incident obligations are checked by the compiled Fe contract, not
// inferred from server-side target arithmetic.
test('Fe incident commitment independently rejects exposure, reserve, and target violations',async()=>{
  const chain=await createLocalChain();
  const incident={market:'0',maximum:'200',reserve:'200'};
  const plan={...actions(1,[[9,200]]),target:{a:'200',b:'300',c:'100'},incident};
  const ready=await chain.previewIncidentActions(plan);
  assert.equal(ready.mask,0);
  assert.equal(ready.operationError,0);
  assert.equal(ready.incidentMask,0);
  assert.equal(ready.goalMatches,true);
  assert.equal(ready.eligible,true);
  assert.deepEqual(ready.final,plan.target);
  assert.equal((await chain.snapshot()).version,'1','Fe preview must be read-only');

  const wrongMarket={...actions(1,[[1,150]]),target:{a:'250',b:'450',c:'100'},incident};
  const badExposure=await chain.previewIncidentActions(wrongMarket);
  assert.equal(badExposure.mask,0,'ordinary Fe policy accepts candidate');
  assert.equal(badExposure.incidentMask,1,'incident-specific Fe check rejects Core > 200');
  assert.equal(badExposure.goalMatches,true);
  assert.equal((await chain.transactIncidentActions(wrongMarket)).success,false);

  const reserveMismatch={...plan,incident:{...incident,reserve:'500'}};
  const badReserve=await chain.previewIncidentActions(reserveMismatch);
  assert.equal(badReserve.mask,0);
  assert.equal(badReserve.incidentMask,2,'Fe independently checks unallocated reserve');
  assert.equal((await chain.transactIncidentActions(reserveMismatch)).success,false);

  const goalMismatch={...plan,target:{...plan.target,b:'301'}};
  const badGoal=await chain.previewIncidentActions(goalMismatch);
  assert.equal(badGoal.incidentMask,0);
  assert.equal(badGoal.goalMatches,false);
  assert.equal((await chain.transactIncidentActions(goalMismatch)).success,false);

  const invalidIncident={...plan,incident:{...incident,market:'3'}};
  assert.equal((await chain.previewIncidentActions(invalidIncident)).incidentMask,4);
  assert.equal((await chain.transactIncidentActions(invalidIncident)).success,false);
  assert.deepEqual([...(Object.values(await chain.snapshot())).slice(0,4)],['1','400','300','100']);

  const reviewer=await chain.previewIncidentActions({...plan,role:'reviewer'});
  assert.equal(reviewer.authorized,false);
  assert.equal(reviewer.eligible,false);
  assert.equal((await chain.transactIncidentActions({...plan,role:'reviewer'})).success,false);

  const receipt=await chain.transactIncidentActions(plan);
  assert.equal(receipt.success,true);
  assert.match(receipt.transactionHash,/^0x[0-9a-f]{64}$/i);
  assert.deepEqual([...(Object.values(await chain.snapshot())).slice(0,4)],['2','200','300','100']);
  const stale=await chain.previewIncidentActions(plan);
  assert.equal(stale.mask & 16,16);
  assert.equal((await chain.transactIncidentActions(plan)).success,false);
  assert.deepEqual([...(Object.values(await chain.snapshot())).slice(0,4)],['2','200','300','100']);
});

test('Fe incident guard accepts temporary intermediate violation but only safe exact final state',async()=>{
  const chain=await createLocalChain();
  const attempt={...actions(1,[[9,250],[13,250],[3,100]]),target:{a:'250',b:'450',c:'100'},
    incident:{market:'0',maximum:'250',reserve:'200'}};
  const candidate=await chain.previewIncidentActions(attempt);
  assert.equal(candidate.mask,0);
  assert.equal(candidate.incidentMask,0);
  assert.equal(candidate.goalMatches,true);
  assert.equal((await chain.transactIncidentActions(attempt)).success,true);
  assert.deepEqual([...(Object.values(await chain.snapshot())).slice(0,4)],['2','250','450','100']);
});
