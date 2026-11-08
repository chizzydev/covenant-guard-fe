#!/usr/bin/env node
// Independent validator for an exported, local Covenant Control audit JSON.
// This verifies internal SHA-256 linkage and claimed outcome consistency.
// It does NOT authenticate the local host, signer, or an external blockchain.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const path = resolve(process.argv[2] || resolve(root, 'evidence', 'owner-v17-local-audit.json'));
const must = (ok, why) => { if (!ok) throw new Error(`EVIDENCE_INVALID: ${why}`); };
const sha = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');

function validate(exported) {
  must(exported && typeof exported === 'object', 'not an object');
  const entries = exported.journalEntries;
  must(Array.isArray(entries) && entries.length > 0, 'empty journal');
  let previous = '0'.repeat(64);
  let sessions = 0, txs = 0;
  for (let i = 0; i < entries.length; i++) {
    const { digest, ...body } = entries[i];
    must(body.index === i + 1, `record ${i+1} index`);
    must(body.previousDigest === previous, `record ${i+1} previousDigest`);
    must(typeof body.timestamp === 'string' && Number.isFinite(Date.parse(body.timestamp)), `record ${i+1} timestamp`);
    must(/^[0-9a-f]{64}$/.test(digest || ''), `record ${i+1} digest format`);
    must(sha(body) === digest, `record ${i+1} digest mismatch`);
    must(body.sessionId && typeof body.sessionId === 'string', `record ${i+1} session`);
    if (body.event?.kind === 'session') sessions++;
    if (body.event?.kind === 'transaction') {
      txs++;
      const e = body.event;
      must(/^0x[0-9a-f]{64}$/i.test(e.txHash || ''), `transaction ${txs} hash format`);
      must(BigInt(e.gasSpent || 0) > 0n, `transaction ${txs} gasSpent`);
      const mirror = exported.transactions?.find(v => v.txHash === e.txHash && v.index === body.index);
      must(mirror && mirror.digest === digest, `transaction ${txs} export mirror`);
      for (const k of ['version','a','b','c']) {
        must(mirror.after?.[k] === e.after?.[k], `transaction ${txs} mirror after.${k}`);
      }
      if (e.outcome === 'committed') {
        must(BigInt(e.after.version) === BigInt(e.before.version) + 1n, `transaction ${txs} version progression`);
        must(e.policyMask === 0 && e.operationError === 0 && e.authorized === true, `transaction ${txs} Fe policy or authorization`);
        must(e.evmException === null && e.rejectionCategory === null, `transaction ${txs} exception on success`);
        must(['a','b','c'].every(k => e.after[k] === e.target[k]), `transaction ${txs} target vs committed state`);
        if (e.operation === 'incident') {
          must(e.feIncidentMask === 0 && e.feIncidentGoalMatches === true, `transaction ${txs} incident Fe verdict`);
          must(e.incidentEnforcement === 'Fe commitIncidentActions()', `transaction ${txs} incident entry point`);
          const m = ['a','b','c'][Number(e.incident.market)];
          must(m !== undefined, `transaction ${txs} incident market`);
          must(BigInt(e.after[m]) <= BigInt(e.incident.maximum), `transaction ${txs} exposure max`);
          // Current demo contract budget is 1000; this is the asserted
          // fixture's explicit budget, NOT a proof of live contract policy.
          const allocated = ['a','b','c'].reduce((n,k)=>n+BigInt(e.after[k]),0n);
          must(allocated <= 1000n && 1000n-allocated >= BigInt(e.incident.reserve), `transaction ${txs} reserve objective`);
        }
      } else if (e.outcome === 'rejected') {
        must(['version','a','b','c'].every(k => e.after[k] === e.before[k]), `transaction ${txs} rejection changed state`);
      } else throw new Error(`EVIDENCE_INVALID: transaction ${txs} unknown outcome`);
    }
    previous = digest;
  }
  must(exported.audit.entries === entries.length, 'reported entry count');
  must(exported.audit.lastDigest === previous, 'reported final digest');
  must(Array.isArray(exported.transactions) && exported.transactions.length === txs, 'transaction count mismatch');
  return {entries:entries.length,sessions,transactions:txs,finalDigest:previous,
    txs:exported.transactions.map(x=>({hash:x.txHash,operation:x.operation,outcome:x.outcome,
      before:x.before,after:x.after,gas:x.gasSpent,policyMask:x.policyMask,incidentMask:x.feIncidentMask}))};
}

try {
  const result=validate(JSON.parse(readFileSync(path,'utf8')));
  console.log('AUDIT_EXPORT_HASH_CHAIN=PASS');
  console.log('AUDIT_EXPORT_OUTCOME_CROSSCHECK=PASS');
  console.log(`JOURNAL_ENTRIES=${result.entries}`);
  console.log(`SESSIONS=${result.sessions}`);
  console.log(`TRANSACTIONS=${result.transactions}`);
  console.log(`FINAL_DIGEST=${result.finalDigest}`);
  for (const tx of result.txs) console.log(`TX=${tx.outcome} ${tx.operation} ${tx.before.version}->${tx.after.version} ${tx.after.a}/${tx.after.b}/${tx.after.c} GAS=${tx.gas} HASH=${tx.hash}`);
  console.log('LIMITATION=LOCAL_RECORD_NOT_TAMPER_PROOF_OR_PUBLIC_CHAIN_PROOF');
} catch(err) {
  console.error(err.message);
  process.exitCode=1;
}
