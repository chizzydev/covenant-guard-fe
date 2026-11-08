// Consolidate only evidence that actually exists after completed Windows runs.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const ev=resolve(root,'results','p07');
const content=(p)=>readFileSync(p);
const sha=(p)=>createHash('sha256').update(content(p)).digest('hex');
const load=(name)=>JSON.parse(content(resolve(ev,name)));
const ledger=[];
for(const seed of [701,1701,2701]){
  const x=load(`seed-${seed}.json`);
  if(x.seed!==seed||x.count!==100||x.successes<8||x.reverts<8||
    !x.provenance?.bytecodeSha256||!x.provenance?.abiSha256)
    throw Error(`P07_MISSING_OR_INVALID_TRACE=${seed}`);
  ledger.push({seed,successfulTx:x.successes,revertedTx:x.reverts,gas:x.totalGas,
    ...x.provenance});
}
const matrix=load('actor-selector-phase-matrix.json');
if(matrix.cells!==72||matrix.outcomes.length!==72||
   matrix.outcomes.some(x=>x.actualSuccess!==x.expected.success))
  throw Error('P07_INCOMPLETE_WRITER_ACTOR_PHASE_MATRIX');
const finite=load('finite-domain.json');
if(finite.total!==432||finite.records.length!==3||
  finite.records.some(x=>x.cases!==144))
  throw Error('P07_FINITE_DOMAIN_INCOMPLETE');
const mutations=load('mutation-manifest.json').mutants;
if(mutations.length!==8)throw Error('P07_MUTANT_INVENTORY_WRONG');
const mutants=[];
for(const m of mutations){
  const e=load(`mutant-${m.name}.json`);
  if(!e.detected||e.firstDivergence!==e.commands.length-1)
    throw Error(`P07_MUTANT_MISSING_COMPILED_DIVERGENCE=${m.name}`);
  if(!existsSync(`${m.artifactPrefix}.bin`)||!existsSync(`${m.artifactPrefix}.abi.json`))
    throw Error(`P07_MUTANT_NOT_COMPILED=${m.name}`);
  mutants.push({name:m.name,sourceSha256:m.mutatedSha256,
    bytecodeSha256:sha(`${m.artifactPrefix}.bin`),
    abiSha256:sha(`${m.artifactPrefix}.abi.json`),
    divergentStep:e.firstDivergence,detected:true});
}
const baselineLog=content(resolve(root,'results','P06_RUN_LOG.txt')).toString('utf8');
for(const marker of ['P06_FE_98_TESTS=PASS','P06_NODE_45_TESTS=PASS','P06_MASTER_FLAGSHIP_CUTOVER=PASS','P06_R4_GATE=PASS']){
  if(!baselineLog.includes(marker))throw Error(`P07_BASELINE_ATTESTATION_MISSING=${marker}`);
}
const contract=resolve(root,'artifacts','guard','flagship','AllocationFlagship');
const runtimeManifest={
 schema:'COVENANT_GUARD_P07_SECURITY_EVIDENCE_V1',
 scope:'Owner Windows local isolated EthereumJS; pinned Fe 26.5.0; NOT formal proof',
 date:new Date().toISOString(),platform:process.platform,arch:process.arch,
 nodeVersion:process.version,os:os.release(),
 pythonVersion:process.env.P07_PYTHON_VERSION||'recorded in P07_RUN_LOG.txt',
 feVersion:'fe 26.5.0 (3dab95f)',
 feBinarySha256:process.env.P07_FE_EXE?sha(process.env.P07_FE_EXE):null,
 source:{
  libraryFeSha256:sha(resolve(root,'library','covenant_transition','src','lib.fe')),
  flagshipFeSha256:sha(resolve(root,'consumers','allocation_flagship','src','lib.fe')),
  packageLockSha256:sha(resolve(root,'package-lock.json')),
  flagshipBinarySha256:sha(`${contract}.bin`),
  flagshipAbiSha256:sha(`${contract}.abi.json`),
 },
 results:{fe:98,baselineNode:45,pythonModelUnit:15,
   seededTransactions:ledger.reduce((n,x)=>n+x.successfulTx+x.revertedTx,0),
   seededReverts:ledger.reduce((n,x)=>n+x.revertedTx,0),
   actorSelectorPhaseCases:matrix.cells,
   finitePreviewCases:finite.total,
   compiledMutants:mutants.length,killedMutants:mutants.filter(x=>x.detected).length},
 seeds:ledger,mutants,
 limitations:[
  'Fe and EthereumJS use the same compiled Fe bytecode; not two independent compilers',
  'Finite domains, seeds and mutants do not establish universal correctness',
  'Dummy keys; in-memory EVM resets on restart; not public deployment or production auth',
  'Python oracle models public allocation flagship not every external library consumer',
  'Generated result files are local evidence, not tamper-proof remote attestations',
 ]
};
writeFileSync(resolve(ev,'P07_RUN_MANIFEST.json'),JSON.stringify(runtimeManifest,null,2));
console.log('P07_EVIDENCE_MANIFEST=PASS');
console.log('P07_FE_98_NODE_45_REGRESSIONS=PASS');
console.log('P07_SEEDED_300_TX=PASS');
console.log('P07_MATRIX_72=PASS');
console.log('P07_FINITE_432=PASS');
console.log('P07_ALL_8_COMPILED_MUTANTS_KILLED=PASS');
