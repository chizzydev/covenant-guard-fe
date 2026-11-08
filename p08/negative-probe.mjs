#!/usr/bin/env node
// P08-R2: verify the pinned, full-storage-borrow external-call conflict.
// Compile this as an explicit Fe ingot; P08 root fe.toml makes the original
// standalone `fe check contracts/IllegalCall.negative.fe` ambiguous.
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const original = readFileSync(resolve(root, 'contracts/IllegalCall.negative.fe'));
const isolated = readFileSync(resolve(root, 'probes/external_call_conflict/src/lib.fe'));
if(!original.equals(isolated))throw Error('P08_ISOLATED_NEGATIVE_FIXTURE_DRIFT');
console.log('P08_ISOLATED_NEGATIVE_FIXTURE_IDENTICAL=PASS');
const fe = process.env.P08_FE_EXE || process.env.FE_EXE || resolve(process.env.HOME || '/home/oai','.fe/bin/fe');
const args = ['check', resolve(root, 'probes/external_call_conflict')];
const result = spawnSync(fe,args,{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024});
const out = [result.stdout||'', result.stderr||''].filter(Boolean).join('\n');
if(out) process.stdout.write(out.endsWith('\n')?out:out+'\n');
console.log('P08_ISOLATED_NEGATIVE_CHECK_EXIT='+result.status);
if(result.error)throw result.error;
if(result.status===null || result.status===0 || !out.includes('error[16-0001]')){
  throw Error('P08_EXTERNAL_CALL_CONFLICT_EXPECTED_ACCESS_CONFLICT_MISSING');
}
console.log('P08_EXTERNAL_NEGATIVE_ISOLATED=PASS');
