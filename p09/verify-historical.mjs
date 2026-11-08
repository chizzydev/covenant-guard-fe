import {spawnSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),destination=resolve(root,'results/p09/frozen-baseline');mkdirSync(destination,{recursive:true});
const py=process.env.P07_PYTHON||(process.platform==='win32'?'python':'python3');
let r=spawnSync(py,['-m','zipfile','-e',resolve(root,'p09/frozen-baseline.zip'),destination],{encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);
for(const file of ['scripts/p06_verify.mjs','scripts/p06_r4_verify.mjs','p07/verify-source.mjs']){
 r=spawnSync(process.execPath,[file],{cwd:destination,encoding:'utf8'});process.stdout.write(r.stdout);process.stderr.write(r.stderr);if(r.status!==0)throw Error('HISTORICAL_FREEZE_FAILED '+file);
}
console.log('P09_HISTORICAL_SOURCE_ONLY_NOT_CORRECTED_SOURCE=PASS');
