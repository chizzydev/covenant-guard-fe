#!/usr/bin/env node
// Early P08 legacy contract build resolution, isolated from root ingot.
// This fixture is byte-for-byte identical to the historical contract; it is
// not a second application, source of authority, or changed security rule.
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const original=readFileSync(resolve(root,'contracts/CovenantControl.fe'));
const isolated=readFileSync(resolve(root,'probes/legacy_build_fixture/src/lib.fe'));
if(!original.equals(isolated))throw Error('P08_LEGACY_BUILD_FIXTURE_DRIFT');
console.log('P08_LEGACY_BUILD_FIXTURE_IDENTICAL=PASS');
const fe=process.env.P08_FE_EXE||process.env.FE_EXE||resolve(process.env.HOME||'/home/oai','.fe/bin/fe');
const out=resolve(root,'results/p08/legacy_build_preflight');
mkdirSync(out,{recursive:true});
const args=['build','--out-dir',out,resolve(root,'probes/legacy_build_fixture')];
const result=spawnSync(fe,args,{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024});
const output=[result.stdout||'',result.stderr||''].filter(Boolean).join('\n');
if(output)process.stdout.write(output.endsWith('\n')?output:output+'\n');
console.log('P08_LEGACY_BUILD_PREFLIGHT_EXIT='+result.status);
if(result.error)throw result.error;
if(result.status!==0)throw Error('P08_LEGACY_BUILD_PREFLIGHT_COMPILER_FAILED');
for(const contract of ['CovenantControl','RogueOperator']){
  for(const ext of ['bin','runtime.bin','abi.json']){
    if(!existsSync(resolve(out,contract+'.'+ext)))throw Error('P08_LEGACY_BUILD_MISSING_ARTIFACT_'+contract+'.'+ext);
  }
  const abi=JSON.parse(readFileSync(resolve(out,contract+'.abi.json'),'utf8'));
  if(!Array.isArray(abi)||!abi.some(x=>x.type==='function'))throw Error('P08_LEGACY_BUILD_INVALID_ABI_'+contract);
}
console.log('P08_LEGACY_ISOLATED_BUILD=PASS');
