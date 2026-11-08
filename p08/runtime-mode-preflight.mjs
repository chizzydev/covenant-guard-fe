#!/usr/bin/env node
// Fail-closed static mapping check. Real HTTP regressions remain mandatory.
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const runner=readFileSync(resolve(root,'p08/portable-gate.mjs'),'utf8');
const server=readFileSync(resolve(root,'app/server.mjs'),'utf8');
const requireExact=(truth,msg)=>{if(!truth)throw Error('P08_MODE_PREFLIGHT_'+msg)};
for(const entry of [
  "['LEGACY','smoke',31,'legacy']",
  "['GUARD_HTTP','guard:http',2,'legacy']",
  "['GUARD_UNIT','guard:unit',6,'flagship']",
  "['FLAGSHIP_CANDIDATE','flagship:candidate',2,'flagship']",
  "['FLAGSHIP_CUTOVER','flagship:cutover',4,'flagship']",
]) requireExact(runner.includes(entry),'MISSING_'+entry);
requireExact(runner.includes('env:{COVENANT_RUNTIME:runtimeMode}'),'RUNNER_ENV_NOT_SCOPED');
requireExact(server.includes("const legacyMode = process.env.COVENANT_RUNTIME === 'legacy';"),'SERVER_RUNTIME_GATE_CHANGED');
requireExact(server.includes('const runtime = legacyMode ? await createLocalChain() : await createFlagshipRuntime();'),'DEFAULT_FLAGSHIP_CHANGED');
console.log('P08_NODE_RUNTIME_ISOLATION_PREFLIGHT=PASS');
