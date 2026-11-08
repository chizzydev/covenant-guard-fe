#!/usr/bin/env node
// Portable Linux/CI acceptance: the same Fe contracts, real local-EVM tests,
// independently executed Python oracle, and compiled source mutants as P07 Windows.
// This runner never claims Windows or CI success and never pushes code.
import {spawnSync} from 'node:child_process';
import {readFileSync,mkdirSync,appendFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const logDir=resolve(root,'results/p09');mkdirSync(logDir,{recursive:true});
const logFile=resolve(logDir,'P09_FULL_RUN_LOG.txt');
writeFileSync(logFile,'=== COVENANT GUARD P09 CORRECTED SOURCE QUALIFICATION ===\n');
const message=(x)=>{console.log(x);appendFileSync(logFile,x+'\n')};
const fe=process.env.P09_FE_EXE||process.env.FE_EXE||(process.platform==='win32'?resolve(process.env.USERPROFILE,'Downloads/FE_PROGRESSIVE_DECISIVE_GATE/toolchain/fe.exe'):resolve(process.env.HOME,'.fe/bin/fe'));
const py=process.env.P07_PYTHON||(process.platform==='win32'?'python':'python3');
const baseEnv={...process.env,P07_PYTHON:py,P07_PYTHON_VERSION:'Python (verified below)',P07_FE_EXE:fe,P08_FE_EXE:fe};
function stage(label,program,args=[],options={}){
  message('STAGE='+label);
  message('COMMAND='+JSON.stringify([program,...args]));
  const result=spawnSync(program==='npm'&&process.platform==='win32'?'npm.cmd':program,args,{shell:program==='npm'&&process.platform==='win32',cwd:root,encoding:'utf8',maxBuffer:128*1024*1024,env:baseEnv,...(options.env?{env:{...baseEnv,...options.env}}:{})});
  const output=[result.stdout||'',result.stderr||''].filter(Boolean).join('\n');
  if(output){process.stdout.write(output.endsWith('\n')?output:output+'\n');appendFileSync(logFile,output+'\n');}
  mkdirSync(resolve(logDir,'command-logs'),{recursive:true});
  writeFileSync(resolve(logDir,'command-logs',label+'.txt'),'COMMAND='+JSON.stringify([program,...args])+'\nEXIT='+result.status+'\n'+output);
  if(result.error||result.status!==0)throw Error(`${label}_FAILED=${result.status}: ${result.error?.message||''}`);
  if(options.marker&&!output.includes(options.marker))throw Error(`${label}_MISSING_MARKER=${options.marker}`);
  if(options.tests!==undefined){
    const matches=[...output.matchAll(/(?:^|\n)[^\n]*?\btests\s+(\d+)\s*(?=\n|$)/g)];
    const pass=[...output.matchAll(/(?:^|\n)[^\n]*?\bpass\s+(\d+)\s*(?=\n|$)/g)];
    const fail=[...output.matchAll(/(?:^|\n)[^\n]*?\bfail\s+(\d+)\s*(?=\n|$)/g)];
    if(!matches.length||!pass.length||!fail.length||Number(matches.at(-1)[1])!==options.tests||Number(pass.at(-1)[1])!==options.tests||Number(fail.at(-1)[1])!==0){
      throw Error(`${label}_NODE_COUNT_MISMATCH_EXPECTED=${options.tests}`);
    }
  }
  if(options.feTests!==undefined&&!new RegExp(`test result:\\s*ok\\.\\s*${options.feTests} passed;\\s*0 failed`).test(output)){
    throw Error(`${label}_FE_COUNT_MISMATCH_EXPECTED=${options.feTests}`);
  }
  message(label+'=PASS');return output;
}
function negative(label,args,expected){
  message('STAGE='+label);
  const r=spawnSync(fe,args,{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024,env:baseEnv});
  const out=(r.stdout||'')+'\n'+(r.stderr||'');
  if(r.status===0||!out.includes(expected)||r.error)throw Error(label+'_INVALID_NEGATIVE_CONTROL');
  message(label+'=PASS (compiler rejected for '+expected+')');
}
try{
  message('ADMIN_REQUIRED=NO');message('PUBLIC_CHAIN=NO');message('REAL_FUNDS=NONE');message('GITHUB_MUTATION=NONE');
  message('P09_PLATFORM='+process.platform+'/'+process.arch);
  if(!existsSync(fe))throw Error('FE_BINARY_NOT_FOUND='+fe);
  const hash=createHash('sha256').update(readFileSync(fe)).digest('hex');
  message('P09_FE_SHA256='+hash);
  const expectedFe=process.platform==='win32'?'d86ca3c6fdadeb8335f7033e3a68fdb7d2aab4eafd22c1e23bec047d2a8b2674':'3732fbe8a6e9d2ea3925d02d0e3a1478bc1e01d742c2be75d3ea7300c46c45f0';
  if(expectedFe){
    if(hash.toLowerCase()!==expectedFe)throw Error('LINUX_FE_PIN_MISMATCH');
    message('P09_FE_BINARY_PIN=PASS');
  }else{message('P09_FE_BINARY_PIN=OBSERVED_NOT_YET_APPROVED');}
  const version=stage('P08_FE_VERSION',fe,['--version'],{marker:'fe 26.5.0 (3dab95f)'});
  stage('P08_EXTERNAL_NEGATIVE_PRECHECK','node',['p08/negative-probe.mjs'],{marker:'P08_EXTERNAL_NEGATIVE_ISOLATED=PASS'});
  stage('P08_LEGACY_BUILD_PRECHECK','node',['p08/legacy-build-probe.mjs'],{marker:'P08_LEGACY_ISOLATED_BUILD=PASS'});
  const pyVersion=stage('P08_PYTHON_VERSION',py,['--version']);
  baseEnv.P07_PYTHON_VERSION=pyVersion.trim();
  stage('P08_NODE_VERSION','node',['--version']);
  stage('P09_CURRENT_INVENTORY','node',['p08/ci-source-inventory.mjs'],{marker:'P08_CI_UNEXPECTED_SOURCE=NONE'});
  stage('P09_HISTORICAL_FREEZE','node',['p09/verify-historical.mjs'],{marker:'P09_HISTORICAL_SOURCE_ONLY_NOT_CORRECTED_SOURCE=PASS'});
  stage('P08_STATIC_P06_R4','node',['scripts/p06_r4_verify.mjs'],{marker:'P06_R4_ORIGINAL_SEVEN_VIEWS_PRESERVED=PASS'});
  stage('P08_TEST_RUNTIME_MODE_PREFLIGHT','node',['p08/runtime-mode-preflight.mjs'],{marker:'P08_NODE_RUNTIME_ISOLATION_PREFLIGHT=PASS'});
  stage('P08_ROOT_FE_CHECK',fe,['check','.']);
  stage('P08_ROOT_FE_TEST',fe,['test','--jobs','1','.'],{feTests:1});
  message('P08_ROOT_FE_TOML_ADOPTION=PASS');
  const targets=[['LIBRARY','library/covenant_transition',15],['P04','consumers/allocation_kernel',37],
    ['ALLOCATION','consumers/allocation_pilot',4],['FLAGSHIP','consumers/allocation_flagship',4],
    ['GOVERNANCE','consumers/governance_registry',4],['LEGACY','contracts/CovenantControl.fe',34]];
  let feTotal=0;
  for(const [name,path,count] of targets){
    stage('P08_FE_'+name+'_CHECK',fe,['check',path]);
    stage('P08_FE_'+name+'_TEST',fe,['test','--jobs','1',path],{feTests:count});feTotal+=count;
  }
  if(feTotal!==98)throw Error('P08_FE_TOTAL_NOT_98');
  message('P08_FE_98_TESTS=PASS');
  negative('P08_PRIVATE_GENERIC_RULES',['check','probes/private_generic_rules'],'error[2-0003]');
  negative('P08_PRIVATE_OLD_REVISION',['check','probes/private_revision'],'error[2-0003]');
  negative('P08_PRIVATE_OLD_RULES',['check','probes/private_rules'],'error[2-0003]');
  negative('P08_EXTERNAL_CALL_CONFLICT',['check','probes/external_call_conflict'],'error[16-0001]');
  const builds=[['P04','consumers/allocation_kernel','artifacts/guard/p04'],
    ['ALLOCATION','consumers/allocation_pilot','artifacts/guard/allocation'],
    ['FLAGSHIP','consumers/allocation_flagship','artifacts/guard/flagship'],
    ['GOVERNANCE','consumers/governance_registry','artifacts/guard/governance'],
    ['LEGACY','probes/legacy_build_fixture','artifacts']];
  for(const [name,path,out] of builds){
    stage('P08_BUILD_'+name,fe,['build','--out-dir',out,path]);
  }
  stage('P08_NPM_CI','npm',['ci','--prefer-offline','--no-audit','--no-fund']);
  stage('P08_NODE_SYNTAX','npm',['run','check:js']);
  // The P06-R4 Windows owner-verified baseline explicitly runs the two
  // historical HTTP suites with COVENANT_RUNTIME=legacy. The default runtime
  // is the single-state flagship, whose guardian prerequisite is deliberately
  // incompatible with the old Incident Desk response assertions. Never change
  // production defaults or weaken security assertions to accommodate them.
  const tests=[['LEGACY','smoke',31,'legacy'],['GUARD_UNIT','guard:unit',6,'flagship'],
    ['GUARD_HTTP','guard:http',2,'legacy'],
    ['FLAGSHIP_CANDIDATE','flagship:candidate',2,'flagship'],
    ['FLAGSHIP_CUTOVER','flagship:cutover',4,'flagship']];
  let nodeTotal=0;
  for(const [name,script,count,runtimeMode] of tests){
    message('P08_NODE_'+name+'_RUNTIME_MODE='+runtimeMode.toUpperCase());
    // Only the child test process sees this environment override; do not
    // modify the runner process environment or the application's default.
    stage('P08_NODE_'+name,'npm',['run',script],{
      tests:count,env:{COVENANT_RUNTIME:runtimeMode},
    });
    nodeTotal+=count;
  }
  message('P08_NODE_LEGACY_AND_FLAGSHIP_MODE_ISOLATION=PASS');
  if(nodeTotal!==45)throw Error('P08_NODE_TOTAL_NOT_45');
  message('P08_NODE_45_TESTS=PASS');
  // P07's collector requires a P06 acceptance log. On Linux this is produced
  // from the 98 Fe and 45 Node stages actually run above, not copied from
  // the owner's Windows log or invented pre-test.
  writeFileSync(resolve(root,'results/P06_RUN_LOG.txt'),
    '=== P09 CORRECTED-SOURCE REPLAY OF P06-R4 BEHAVIORAL SUITES (GENERATED) ===\n'+
    readFileSync(logFile,'utf8')+'\n'+
    'P06_FE_98_TESTS=PASS\nP06_NODE_45_TESTS=PASS\n'+
    'P06_MASTER_FLAGSHIP_CUTOVER=PASS\nP06_R4_GATE=PASS\n');
  message('P09_CURRENT_SOURCE_P06_BEHAVIORAL_RECEIPT=PASS');
  const oracle=stage('P08_PYTHON_ORACLE',py,['-m','unittest','discover','-s','p07/spec','-p','test_oracle.py','-v'],{marker:'Ran 15 tests'});
  if(!/^OK\s*$/m.test(oracle))throw Error('P08_PYTHON_ORACLE_NOT_OK');
  stage('P08_ABI_PROVENANCE','node',['p07/provenance.mjs'],{marker:'P07_ALL_EIGHT_WRITERS_ENUMERATED=PASS'});
  const diff=stage('P08_EVM_DIFFERENTIAL','node',['--test','p07/tests/differential.test.mjs'],{marker:'P07_FINITE_DOMAIN_432_PREVIEWS=PASS',tests:5});
  for(const marker of ['P07_SEEDED_DIFF_701=PASS','P07_SEEDED_DIFF_1701=PASS','P07_SEEDED_DIFF_2701=PASS','P07_FULL_72_CELL_ABI_MATRIX=PASS']){
    if(!diff.includes(marker))throw Error('P08_MISSING_DIFFERENTIAL='+marker);
  }
  stage('P08_PREPARE_MUTANTS',py,['p07/mutation_prepare.py'],{marker:'P07_MUTANTS_PREPARED=8'});
  const manifest=JSON.parse(readFileSync(resolve(root,'results/p07/mutation-manifest.json'),'utf8'));
  if(manifest.mutants?.length!==8)throw Error('P08_MUTANT_INVENTORY_INCOMPLETE');
  for(const m of manifest.mutants){
    stage('P08_BUILD_MUTANT_'+m.name,fe,['build','--out-dir',dirname(m.artifactPrefix),m.project]);
    if(!existsSync(m.artifactPrefix+'.bin')||!existsSync(m.artifactPrefix+'.abi.json'))throw Error('P08_UNCOMPILED_MUTANT_'+m.name);
  }
  const mut=stage('P08_MUTANTS_EVM','node',['--test','p07/tests/mutation.test.mjs'],{tests:8,marker:'P07_MUTANT_SELF_MOVE=KILLED'});
  for(const m of manifest.mutants){if(!mut.includes('P07_MUTANT_'+m.name.toUpperCase()+'=KILLED'))throw Error('P08_MUTANT_NOT_KILLED='+m.name);}
  stage('P08_COLLECT_P07','node',['p07/collect-evidence.mjs'],{marker:'P07_EVIDENCE_MANIFEST=PASS'});
  stage('P08_JUDGE_WITNESS','node',['p08/judge-witness.mjs'],{marker:'P08_JUDGE_WITNESS_4_ACCEPT_2_REJECT=PASS'});
  stage('P09_EXTRA_FE_CHECK',fe,['check','p09/fe']);
  stage('P09_EXTRA_FE_TEST',fe,['test','--jobs','1','p09/fe'],{feTests:3});
  stage('P09_POSITIVE_ACCESS',fe,['check','p09/probes/external_positive']);
  stage('P09_ENGINEERING_REGRESSIONS','node',['--test','p09/tests/engineering.test.mjs'],{tests:27});
  stage('P09_EXTRA_MUTANTS_PREP',py,['p09/mutations.py']);
  const extra=JSON.parse(readFileSync(resolve(root,'results/p09/extra-mutants.json'),'utf8'));
  for(const m of extra)stage('P09_EXTRA_MUTANT_BUILD_'+m.name,fe,['build','--out-dir',dirname(m.artifactPrefix),m.project]);
  stage('P09_EXTRA_MUTANTS','node',['--test','p09/tests/mutations.test.mjs'],{tests:3});
  stage('P09_PROVENANCE','node',['p09/provenance.mjs']);
  message('P09_CURRENT_SOURCE_FULL_FE_EVM_ORACLE_AND_MUTANTS=PASS');
  message('P09_'+process.platform.toUpperCase()+'_FULL_GATE=PASS');
  message('P09_PLATFORM_PIN_LOCK_COMPLETE=true');
  message('P08_LINUX_CROSS_PLATFORM_EQUIVALENCE=REQUIRES_OWNER_WINDOWS_AND_UBUNTU_COMPARISON');
  message('REPORT_PATH='+logFile);
}catch(e){message('P09_'+process.platform.toUpperCase()+'_FULL_GATE=FAIL');message('ERROR='+e.message);message('REPORT_PATH='+logFile);process.exitCode=1;}
