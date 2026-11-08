#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync,existsSync } from 'node:fs';
import { resolve,dirname,sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const get=p=>readFileSync(resolve(root,p));
const sha=b=>createHash('sha256').update(b).digest('hex').toUpperCase();
const manifest=get('MANIFEST_SHA256.txt').toString('utf8').trim().split(/\r?\n/);
for(const [i,line] of manifest.entries()) {
  const match=/^([A-F0-9]{64})  ([A-Za-z0-9_.\/-]+)$/.exec(line);
  if(!match)throw Error(`P06_R3_MANIFEST_LINE_${i+1}`);
  const rel=match[2],path=resolve(root,rel);
  if(rel.startsWith('/')||rel.split('/').includes('..')||rel.includes('\\')||!path.startsWith(root+sep)||!existsSync(path))throw Error(`P06_R3_MANIFEST_UNSAFE=${rel}`);
  if(sha(get(rel))!==match[1])throw Error(`P06_R3_HASH_MISMATCH=${rel}`);
}
console.log(`P06_R3_MANIFEST_FILES_VERIFIED=${manifest.length}`);
const baseline=get('docs/P05_R1_REFERENCE_LIB.fe').toString('utf8');
const candidate=get('library/covenant_transition/src/lib.fe').toString('utf8');
const digest=get('docs/P05_ORIGINAL_LIBRARY_SHA256.txt').toString('utf8').trim();
if(sha(Buffer.from(baseline))!==digest)throw Error('P06_R3_P05_REFERENCE_HASH_INVALID');
const anchor='pub struct Guard3 {';
const insertion='// P06-R3: reusable ordered instruction interpreter.';
const method='    pub fn activate_progressive(mut self,_ expected:u256,_ market:u256,';
const upper=baseline.indexOf(anchor),lower=candidate.indexOf(insertion);
if(upper<0||lower<0||candidate.slice(0,lower).trimEnd()!==baseline.slice(0,upper).trimEnd())throw Error('P06_R3_P05_PRE_GUARD_DRIFT');
const oldGuard=baseline.slice(upper,baseline.indexOf(method,upper));
const newGuard=candidate.slice(candidate.indexOf(anchor),candidate.indexOf('    // Flagship',candidate.indexOf(anchor)));
if(newGuard.trimEnd()!==oldGuard.trimEnd())throw Error('P06_R3_P05_GUARD_METHODS_DRIFT');
const oldTail=baseline.slice(baseline.indexOf(method,upper));
if(!candidate.includes(oldTail))throw Error('P06_R3_P05_INCIDENT_BEHAVIOR_DRIFT');
console.log('P06_R3_P05_UNMODIFIED_SECTIONS=PASS');
const prefix=get('docs/P04_PREFIX_SHA256.txt').toString('utf8').trim().split(' ');
const pre=Buffer.from(candidate).subarray(0,Number(prefix[0]));
if(sha(pre)!==prefix[1])throw Error('P06_R3_P04_PREFIX_DRIFT');
console.log('P06_R3_P04_GUARDED_PREFIX=PASS');
const flagship=get('consumers/allocation_flagship/src/lib.fe').toString('utf8');
for(const name of ['CommitActions','CommitGoalActions','CommitMigration','CommitIncidentActions','ActivateProgressive','ActivateContain','ReleaseIncidentBound']) {
  if(!flagship.includes(name))throw Error('P06_R3_FLAGSHIP_WRITER_NOT_FOUND='+name);
}
if(/\bEarlyInvalid\b|\bReleaseIncident\s*\{/.test(flagship))throw Error('P06_R3_FORBIDDEN_PUBLIC_WRITER');
console.log('P06_R3_FLAGSHIP_WRITER_INVENTORY=PASS');
