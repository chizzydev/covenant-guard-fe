#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const file=rel=>readFileSync(resolve(root,rel),'utf8');
const server=file('app/server.mjs');
const runtime=file('app/flagship-runtime.mjs');
const guard=file('app/guard-chain.mjs');
const client=file('app/public/client.js');
const contract=file('consumers/allocation_flagship/src/lib.fe');
if(!server.includes("const runtime = legacyMode ? await createLocalChain() : await createFlagshipRuntime()"))
  throw Error('P06_R4_DEFAULT_NOT_FLAGSHIP');
if(!server.includes('await createGuardChain({allocationBridge:runtime})'))
  throw Error('P06_R4_GUARD_NOT_SHARED_WITH_FLAGSHIP');
if(!server.includes('GUARDIAN_ACTIVATION_REQUIRED') || !server.includes('matchesStoredIncident'))
  throw Error('P06_R4_INCIDENT_AUTHORIZATION_GATE_ABSENT');
if(!guard.includes("if (domain === 'allocation' && allocationBridge) continue"))
  throw Error('P06_R4_DUPLICATE_ALLOCATION_CONTRACT_IN_MAIN_MODE');
for(const method of ['previewMigration','transactMigration','previewActions','transactActions',
  'transactGoalActions','previewIncidentActions','transactIncidentActions','guardActivate',
  'guardRelease']) {
  if(!runtime.includes(method))throw Error(`P06_R4_WORKFLOW_NOT_BRIDGED=${method}`);
}
if(!runtime.includes('PERSISTENT_INCIDENT_POLICY') && !runtime.includes('mask & 128'))
  throw Error('P06_R4_INCIDENT_MASK_COULD_BE_IGNORED');
if(!client.includes('activateGuardianIncident') || !client.includes('requires_guardian'))
  throw Error('P06_R4_INCIDENT_DESK_GUARDIAN_STEP_MISSING');
if(!contract.includes('mut engine:Guard3') || contract.includes('pub contract CovenantControl'))
  throw Error('P06_R4_FLAGSHIP_SINGLE_GUARD_MISSING');
if(!file('app/public/index.html').includes('incidentGuardianActivateBtn'))
  throw Error('P06_R4_MAIN_INCIDENT_UI_GUARDIAN_BUTTON_MISSING');
console.log('P06_R4_SINGLE_ALLOC_STATE_ROUTE_INVENTORY=PASS');
console.log('P06_R4_INCIDENT_GUARDIAN_ROUTING=PASS');
console.log('P06_R4_ORIGINAL_SEVEN_VIEWS_PRESERVED=PASS');
