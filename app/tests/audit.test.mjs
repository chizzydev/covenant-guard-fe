import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAuditJournal } from '../lib/audit.mjs';

const sampleTransaction = (txHash = `0x${'a'.repeat(64)}`) => ({
  kind: 'transaction', outcome: 'committed', role:'admin', sender:`0x${'b'.repeat(40)}`,
  txHash, nonce:'1', policyMask:0, authorized:true, gasSpent:'31231',
  rejectionCategory:null, evmException:null,
  proposal:{expectedVersion:'1',a:'350',b:'350',c:'150'},
  before:{version:'1',a:'400',b:'300',c:'100'},
  after:{version:'2',a:'350',b:'350',c:'150'},
});

function withTemp(fn) {
  const root = mkdtempSync(join(tmpdir(), 'covenant-audit-'));
  try { fn(join(root,'deep','audit.jsonl')); }
  finally { rmSync(root, {recursive:true,force:true}); }
}

test('audit journal persists transactions and separates EVM sessions', () => withTemp((path) => {
  const first = createAuditJournal(path, {sessionId:'A'});
  first.append(sampleTransaction());
  assert.equal(first.list({session:'current'}).length, 1);
  assert.equal(first.status().entries, 2);
  const second = createAuditJournal(path, {sessionId:'B'});
  assert.equal(second.list({session:'current'}).length, 0);
  assert.equal(second.list().length, 1);
  assert.equal(second.status().entries, 3);
  second.append({...sampleTransaction('0x'+'c'.repeat(64)), outcome:'rejected', rejectionCategory:'POLICY_INVARIANT'});
  assert.equal(second.list({session:'current'}).length, 1);
  assert.equal(second.list().length, 2);
  assert.notEqual(first.status().lastDigest, second.status().lastDigest);
}));

test('audit journal rejects altered transaction records on next startup', () => withTemp((path) => {
  const journal = createAuditJournal(path, {sessionId:'A'});
  journal.append(sampleTransaction());
  const original = readFileSync(path,'utf8');
  writeFileSync(path, original.replace('"gasSpent":"31231"','"gasSpent":"99999"'));
  assert.throws(() => createAuditJournal(path,{sessionId:'B'}), /INTEGRITY_FAILURE/);
}));

test('audit journal fails closed on truncated final line', () => withTemp((path) => {
  createAuditJournal(path);
  const original = readFileSync(path,'utf8');
  writeFileSync(path, original.trimEnd());
  assert.throws(() => createAuditJournal(path), /INCOMPLETE_LAST_LINE/);
}));
