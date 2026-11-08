// Local, hash-linked audit journal. This is NOT an on-chain proof and the
// journal can be rewritten by someone who controls the local files.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';

const GENESIS = '0'.repeat(64);
const hash = (text) => createHash('sha256').update(text).digest('hex');

export function createAuditJournal(filepath, { sessionId = randomUUID() } = {}) {
  mkdirSync(dirname(filepath), { recursive: true });
  const entries = [];
  if (existsSync(filepath)) {
    const content = readFileSync(filepath, 'utf8');
    if (content && !content.endsWith('\n')) {
      throw new Error('AUDIT_JOURNAL_INCOMPLETE_LAST_LINE');
    }
    for (const [index, line] of content.split('\n').filter(Boolean).entries()) {
      let entry;
      try { entry = JSON.parse(line); } catch { throw new Error(`AUDIT_JOURNAL_BAD_JSON_LINE=${index+1}`); }
      const { digest, ...body } = entry;
      const expectedPrevious = index ? entries[index-1].digest : GENESIS;
      if (
        body.index !== index + 1 ||
        body.previousDigest !== expectedPrevious ||
        !/^[a-f0-9]{64}$/.test(String(digest)) ||
        hash(JSON.stringify(body)) !== digest
      ) throw new Error(`AUDIT_JOURNAL_INTEGRITY_FAILURE_LINE=${index+1}`);
      entries.push(entry);
    }
  }

  function append(event) {
    const body = {
      index: entries.length + 1,
      previousDigest: entries.at(-1)?.digest || GENESIS,
      timestamp: new Date().toISOString(),
      sessionId,
      event,
    };
    const entry = { ...body, digest: hash(JSON.stringify(body)) };
    appendFileSync(filepath, JSON.stringify(entry) + '\n', { encoding: 'utf8', flag: 'a' });
    entries.push(entry);
    return entry;
  }

  function list({ session = 'all', limit = 300 } = {}) {
    const selected = session === 'current'
      ? entries.filter(entry => entry.sessionId === sessionId)
      : entries;
    return selected.filter(entry => entry.event.kind === 'transaction')
      .slice(-limit).reverse().map(entry => ({ ...entry.event, time: entry.timestamp, index: entry.index, sessionId: entry.sessionId, digest: entry.digest }));
  }

  function exportRecords() { return entries.map(entry => ({...entry})); }

  function status() {
    return {
      sessionId,
      verifiedAtStartup: true,
      lastDigest: entries.at(-1)?.digest || GENESIS,
      entries: entries.length,
      journal: 'local hash-linked JSONL, not an on-chain or tamper-proof attestation',
    };
  }

  append({ kind: 'session', label: 'local EVM started; in-memory contract state reset' });
  return { append, list, exportRecords, status, sessionId, path: filepath };
}
