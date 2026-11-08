#!/usr/bin/env node
// The shortest independent on-EVM demonstration of Fe-specific behavior.
// Runs against freshly compiled Fe bytecode in an isolated EthereumJS VM.
// This is synthetic capacity, not real funds or a chain deployment.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalChain } from '../app/chain.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chain = await createLocalChain();
const incident={market:'0',maximum:'200',reserve:'200'};
const mk = (steps, target, otherIncident=incident, role='admin',version=1n) => ({
  expectedVersion:version,role,incident:otherIncident,target,
  steps:steps.map(([opcode,amount])=>({opcode:BigInt(opcode),amount:BigInt(amount)})),
});
const snapshot = () => chain.snapshot();
const state4 = s=>({version:s.version,a:s.a,b:s.b,c:s.c});
const initial = await snapshot();
assert.deepEqual(state4(initial),{version:'1',a:'400',b:'300',c:'100'});

// The ordinary protocol policy permits moving 150 Core -> Supporting,
// but the incident maximum of Core 200 independently forbids that result.
const badExposure=mk([[1,150]],{a:'250',b:'450',c:'100'});
const ordinary=await chain.previewActions(badExposure);
const incidentReject=await chain.previewIncidentActions(badExposure);
assert.equal(ordinary.mask,0);
assert.equal(ordinary.operationError,0);
assert.equal(incidentReject.mask,0);
assert.equal(incidentReject.incidentMask,1);
assert.equal(incidentReject.goalMatches,true);
assert.equal((await chain.transactIncidentActions(badExposure)).success,false);
assert.deepEqual(state4(await snapshot()),state4(initial));

// Same valid operation, but an incident minimum reserve higher than the
// final free capacity: Fe must reject *inside* the transaction as well.
const valid=mk([[9,200]],{a:'200',b:'300',c:'100'});
const badReserve=mk([[9,200]],valid.target,{...incident,reserve:'500'});
const reservePreview=await chain.previewIncidentActions(badReserve);
assert.equal(reservePreview.mask,0);
assert.equal(reservePreview.incidentMask,2);
assert.equal((await chain.transactIncidentActions(badReserve)).success,false);
assert.deepEqual(state4(await snapshot()),state4(initial));

// Exact-goal mismatch, unauthorized operator, and correct positive commit.
const falseTarget=mk([[9,200]],{a:'201',b:'300',c:'100'});
const mismatched=await chain.previewIncidentActions(falseTarget);
assert.equal(mismatched.goalMatches,false);
assert.equal((await chain.transactIncidentActions(falseTarget)).success,false);
const reviewer=await chain.previewIncidentActions({...valid,role:'reviewer'});
assert.equal(reviewer.authorized,false);
assert.equal((await chain.transactIncidentActions({...valid,role:'reviewer'})).success,false);
assert.deepEqual(state4(await snapshot()),state4(initial));

const acceptedPreview=await chain.previewIncidentActions(valid);
assert.equal(acceptedPreview.eligible,true);
assert.equal(acceptedPreview.incidentMask,0);
assert.equal(acceptedPreview.goalMatches,true);
const committed=await chain.transactIncidentActions(valid);
assert.equal(committed.success,true);
const final=await snapshot();
assert.deepEqual(state4(final),{version:'2',a:'200',b:'300',c:'100'});
assert.equal((await chain.transactIncidentActions(valid)).success,false,'stale v1 rejected');
assert.deepEqual(state4(await snapshot()),state4(final));

const result={
  version:'1.8.0',mode:'independent in-memory Fe EVM witness',
  feContractSha256:'3b98628a9ead95cf271cee86c62f0d20e88398314ac6ac62dc1ae717a1b7286d',
  compiler:'Fe 26.5.0 required; see verification log',
  original:state4(initial),
  ordinaryPolicyValidButIncidentRejected:{ordinaryMask:ordinary.mask,incidentMask:incidentReject.incidentMask,reverted:true},
  reserveAttestationRejected:{incidentMask:reservePreview.incidentMask,reverted:true},
  wrongExactTargetRejected:mismatched.goalMatches===false,
  reviewerRejected:reviewer.authorized===false,
  committed:{target:valid.target,actual:state4(final),txHash:committed.transactionHash,gasUsed:committed.gasSpent},
  staleVersionRejected:true,
  warnings:['Test account is disposable; no real credentials','EVM state is in memory','No live oracle, external risk feed, or public blockchain','No production security assurance'],
};
mkdirSync(resolve(root,'results'),{recursive:true});
writeFileSync(resolve(root,'results','JUDGE_DEMO.json'),JSON.stringify(result,null,2)+'\n');
console.log('FE_INCIDENT_INDEPENDENT_WITNESS=PASS');
console.log('ORDINARY_POLICY_VALID_BUT_INCIDENT_EXPOSURE_REJECTED=PASS');
console.log('INCIDENT_RESERVE_AND_FALSE_TARGET_REJECTED=PASS');
console.log('UNAUTHORIZED_AND_STALE_REJECTED=PASS');
console.log(`ACCEPTED_STATE=v${final.version} ${final.a}/${final.b}/${final.c}`);
console.log(`LOCAL_TX=${committed.transactionHash}`);
console.log(`GAS=${committed.gasSpent}`);
console.log('WITNESS_PATH=results/JUDGE_DEMO.json');
console.log('LIVE_DEPLOYMENT=NONE');
