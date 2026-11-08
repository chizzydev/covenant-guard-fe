import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalChain } from './chain.mjs';
import { createFlagshipRuntime } from './flagship-runtime.mjs';
import { createGuardChain } from './guard-chain.mjs';
import { createGuardApi } from './guard-api.mjs';
import { createAuditJournal } from './lib/audit.mjs';
import { planFromFe } from './lib/planner.mjs';
import { assessIncident } from './lib/incident.mjs';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = resolve(appRoot, 'app', 'public');
const host = '127.0.0.1';
const port = Number(process.env.PORT || 4549);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
// Default: one allocation state, owned by the Fe AllocationFlagship contract.
// Explicit legacy mode exists ONLY for byte-for-byte P06-R3 regression tests.
const legacyMode = process.env.COVENANT_RUNTIME === 'legacy';
const runtime = legacyMode ? await createLocalChain() : await createFlagshipRuntime();
const guardRuntime = legacyMode ? await createGuardChain() :
  await createGuardChain({allocationBridge:runtime});
const audit = createAuditJournal(process.env.COVENANT_AUDIT_PATH || resolve(appRoot, 'results', 'audit.jsonl'));

// EthereumJS VM is a shared stateful object. Serialize all contract reads and
// transactions to prevent competing HTTP requests from racing the VM itself.
let queue = Promise.resolve();
function serialized(work) {
  const operation = queue.then(work);
  queue = operation.catch(() => {});
  return operation;
}

function reply(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(payload));
}

async function jsonBody(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw Error('Content-Type must be application/json');
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 16_384) throw Error('Request too large');
  }
  return JSON.parse(text || '{}');
}

function parseUInt(value, name) {
  if (!/^(0|[1-9][0-9]{0,19})$/.test(String(value))) {
    throw Error(`${name}: expected nonnegative decimal integer (up to 20 digits)`);
  }
  return BigInt(value);
}

const guardApi = createGuardApi({
  runtime:guardRuntime,audit,serialized,reply,jsonBody,parseUInt,host,port,
});

function parseProposal(data) {
  return {
    expectedVersion: parseUInt(data.expectedVersion, 'expectedVersion'),
    a: parseUInt(data.a, 'a'),
    b: parseUInt(data.b, 'b'),
    c: parseUInt(data.c, 'c'),
  };
}

function parseMigration(data) {
  if (!Array.isArray(data.steps) || data.steps.length < 1 || data.steps.length > 3) {
    throw Error('Migration requires 1 to 3 ordered steps');
  }
  const steps = data.steps.map((step, i) => {
    if (!step || typeof step !== 'object' || Array.isArray(step)) {
      throw Error(`Step ${i+1} is not an object`);
    }
    const market = parseUInt(step.market, `step${i+1}.market`);
    if (market > 2n) throw Error(`Step ${i+1} market must be 0, 1 or 2`);
    const value = parseUInt(step.value, `step${i+1}.value`);
    return { market, value };
  });
  return {expectedVersion:parseUInt(data.expectedVersion,'expectedVersion'),steps};
}
function parseActions(data) {
  if (!Array.isArray(data.steps) || data.steps.length < 1 || data.steps.length > 3) {
    throw Error('Operation plan requires 1 to 3 ordered steps');
  }
  const steps = data.steps.map((step,i) => {
    if (!step || typeof step !== 'object' || Array.isArray(step)) {
      throw Error(`Action ${i+1} is not an object`);
    }
    const opcode = parseUInt(step.opcode,`action${i+1}.opcode`);
    if (opcode > 1_000_000n) throw Error(`Action ${i+1} opcode is out of input range`);
    const amount = parseUInt(step.amount,`action${i+1}.amount`);
    return {opcode,amount};
  });
  return {expectedVersion:parseUInt(data.expectedVersion,'expectedVersion'),steps};
}
function parseGoal(data) {
  const goal=data.goal;
  if(!goal || typeof goal!=='object' || Array.isArray(goal)) throw Error('Goal must be an object');
  if(goal.kind==='target') return {
    kind:'target',a:String(parseUInt(goal.a,'goal.a')),
    b:String(parseUInt(goal.b,'goal.b')),c:String(parseUInt(goal.c,'goal.c')),
  };
  if(goal.kind==='shift') {
    const source=parseUInt(goal.source,'goal.source');
    const destination=parseUInt(goal.destination,'goal.destination');
    const quantity=parseUInt(goal.quantity,'goal.quantity');
    if(source>2n || destination>2n || source===destination || quantity===0n) {
      throw Error('Invalid move: select two different markets and a positive quantity');
    }
    return {kind:'shift',source:String(source),destination:String(destination),quantity:String(quantity)};
  }
  throw Error('Invalid goal kind: choose target or shift');
}
function selectedIncident(data) {
  const incident=data.incident;
  if(!incident || typeof incident!=='object' || Array.isArray(incident)) throw Error('Incident request must be an object');
  const market=parseUInt(incident.market,'incident.market');
  if(market>2n) throw Error('Affected market must be Core, Supporting, or Satellite');
  const maximum=parseUInt(incident.maximum,'incident.maximum');
  const reserve=parseUInt(incident.reserve,'incident.reserve');
  return {incident:{market:String(market),maximum:String(maximum),reserve:String(reserve)},
    expectedVersion:String(parseUInt(data.expectedVersion,'expectedVersion')),role:roleOf(data)};
}
function selectedPlan(data) {
  const goal=parseGoal(data);
  const expectedVersion=String(parseUInt(data.expectedVersion,'expectedVersion'));
  const role=roleOf(data);
  return {goal,expectedVersion,role};
}
function actionFields(p) {
  return {
    expectedVersion:String(p.expectedVersion),
    steps:p.steps.map(({opcode,amount}) => ({opcode:String(opcode),amount:String(amount)})),
  };
}
function migrationFields(p) {
  return {
    expectedVersion:String(p.expectedVersion),
    steps:p.steps.map(({market,value}) => ({market:String(market),value:String(value)})),
  };
}
function roleOf(data) {
  if (data.role !== 'admin' && data.role !== 'reviewer') throw Error('Invalid local demo role');
  return data.role;
}

function fields(s) { return { version: s.version, a: s.a, b: s.b, c: s.c }; }
function protectedFields(s) {return {...fields(s),incident:s.incident??null,deficits:s.deficits??null};}
function matchesStoredIncident(s, incident) {
  return s.incident && Number(s.incident.phase)!==0 &&
    s.incident.market===String(incident.market) &&
    s.incident.maximum===String(incident.maximum) &&
    s.incident.reserveMinimum===String(incident.reserve);
}
function proposalFields(p) { return { expectedVersion: String(p.expectedVersion), a: String(p.a), b: String(p.b), c: String(p.c) }; }
function rejectionCategory(preflight) {
  if (!preflight.authorized) return 'UNAUTHORIZED_OPERATOR';
  if (preflight.mask & 16) return 'STALE_VERSION';
  if (preflight.mask & 128) return 'PERSISTENT_INCIDENT_POLICY';
  if (preflight.operationError) return 'OPERATION_PRECONDITION';
  if (preflight.mask) return 'POLICY_INVARIANT';
  return 'EVM_REVERT';
}

async function api(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/state') {
    return serialized(async () => reply(res, 200, { state: await runtime.snapshot(), runtime: runtime.details, history: audit.list({session:'current',limit:6}), audit: audit.status() }));
  }
  if (req.method === 'GET' && pathname === '/api/history') {
    return reply(res, 200, { history: audit.list({limit:500}), audit: audit.status() });
  }
  if (req.method === 'GET' && pathname === '/api/history/export') {
    const payload = { exportedAt: new Date().toISOString(), audit: audit.status(), journalEntries: audit.exportRecords(), transactions: audit.list({limit:100000}) };
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="covenant-control-local-audit.json"',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    });
    return res.end(JSON.stringify(payload, null, 2));
  }
  if (req.method !== 'POST') return reply(res, 405, { error: 'POST required' });
  const origin = req.headers.origin;
  if (origin && origin !== `http://${host}:${port}` && origin !== `http://localhost:${port}`) {
    return reply(res, 403, { error: 'Cross-origin modification blocked' });
  }
  const data = await jsonBody(req);
  if (pathname === '/api/preview') {
    const p = parseProposal(data);
    return serialized(async () => reply(res, 200, { preview: await runtime.preview({ ...p, role: roleOf(data) }) }));
  }
  // Fe-verified target planning. Planning may involve off-chain arithmetic;
  // safety, signer authorization, and atomic terminal-goal equality do not.
  if(pathname === '/api/planner/plan') {
    const p=selectedPlan(data);
    return serialized(async () => {
      const state=await runtime.snapshot();
      if(state.version!==p.expectedVersion) return reply(res,409,{error:'Configuration changed. Reload and generate a fresh plan.'});
      const plan=await planFromFe({state,goal:p.goal,role:p.role,previewActions:runtime.previewActions});
      return reply(res,200,{plan});
    });
  }
  if(pathname === '/api/planner/commit') {
    const p=selectedPlan(data);
    if(!/^[0-9a-f]{64}$/.test(String(data.digest))) throw Error('Invalid plan fingerprint');
    return serialized(async () => {
      const before=await runtime.snapshot();
      if(before.version!==p.expectedVersion) return reply(res,409,{error:'The configuration changed. Replan from the latest state; no transaction was submitted.'});
      const plan=await planFromFe({state:before,goal:p.goal,role:p.role,previewActions:runtime.previewActions});
      if(plan.status!=='ready' || plan.digest!==data.digest) {
        return reply(res,409,{error:'The goal or proposed plan is no longer eligible. Generate a fresh Fe-verified plan; no transaction was submitted.'});
      }
      if(!plan.preview?.goalMatches && !plan.goalMatches) throw Error('PLANNER_GOAL_NOT_VERIFIED');
      const tx=await runtime.transactGoalActions({
        expectedVersion:BigInt(before.version),
        steps:plan.steps.map(s=>({opcode:BigInt(s.opcode),amount:BigInt(s.amount)})),
        target:plan.target,role:p.role,
      });
      const after=await runtime.snapshot();
      if(tx.success) {
        if(BigInt(after.version)!==BigInt(before.version)+1n ||
          ['a','b','c'].some(k=>after[k]!==plan.target[k])) {
          throw Error('FE_GOAL_COMMIT_STATE_MISMATCH');
        }
      } else if(JSON.stringify(protectedFields(after))!==JSON.stringify(protectedFields(before))) {
        throw Error('FE_GOAL_REVERT_CHANGED_STATE');
      }
      const entry=audit.append({
        kind:'transaction',operation:'planner',outcome:tx.success?'committed':'rejected',
        role:p.role,sender:tx.sender,txHash:tx.transactionHash,nonce:tx.nonce,
        goal:p.goal,objective:plan.objective,target:plan.target,planFingerprint:plan.digest,
        proposal:{expectedVersion:before.version,steps:plan.steps},
        fePreviewFinal:plan.preview.final,stageMasks:plan.preview.stageMasks,
        operationError:plan.preview.operationError,
        policyMask:plan.preview.mask,authorized:plan.preview.authorized,
        before:fields(before),after:fields(after),
        protectedBefore:protectedFields(before),protectedAfter:protectedFields(after),gasSpent:tx.gasSpent,evmException:tx.error,
        rejectionCategory:tx.success?null:'EVM_REVERT',
      });
      return reply(res,200,{
        result:{...tx,rejectionCategory:entry.event.rejectionCategory},
        plan:{status:tx.success?'committed':'rejected',target:plan.target,digest:plan.digest},
        state:after,history:audit.list({session:'current',limit:6}),audit:audit.status(),
      });
    });
  }
  // Incident response: operator-supplied alert, state-derived candidate goals,
  // Fe-verified alternatives, and exact-target commitment. No oracle feed.
  if(pathname === '/api/incident/assess') {
    const p=selectedIncident(data);
    return serialized(async()=>{
      const state=await runtime.snapshot();
      if(state.version!==p.expectedVersion) return reply(res,409,{error:'State changed. Reload the incident from the current Fe configuration.'});
      if (!legacyMode && Number(state.incident.phase)!==0 && !matchesStoredIncident(state,p.incident)) {
        return reply(res,409,{error:'GUARDIAN_OBJECTIVE_MISMATCH: the active Fe incident is immutable. Match its exact objective or request guardian release after containment.'});
      }
      const assessment=await assessIncident({state,incident:p.incident,role:p.role,previewActions:runtime.previewActions,previewIncidentActions:runtime.previewIncidentActions});
      if (!legacyMode && Number(state.incident.phase)===0) {
        assessment.requiresGuardian=true;
        assessment.status='requires_guardian';
        assessment.reason='Review prospective Fe responses, then explicitly activate this objective with the guardian before operator commitment. No stored incident exists yet.';
        assessment.options=assessment.options.map(o=>o.status==='ready'?{...o,status:'requires_guardian'}:o);
      }
      return reply(res,200,{assessment});
    });
  }
  if(pathname === '/api/incident/commit') {
    const p=selectedIncident(data);
    const strategy=String(data.strategy||'');
    if(!['continuity','spread','reserve'].includes(strategy)) throw Error('Unknown response strategy');
    const digest=String(data.digest||'');
    if(!/^[a-f0-9]{64}$/.test(digest)) throw Error('Invalid incident plan fingerprint');
    return serialized(async()=>{
      const before=await runtime.snapshot();
      if(before.version!==p.expectedVersion) return reply(res,409,{error:'State changed since assessment. No transaction submitted; reassess this incident.'});
      if (!legacyMode && !matchesStoredIncident(before,p.incident)) {
        return reply(res,409,{error:'GUARDIAN_ACTIVATION_REQUIRED: an authorized guardian must activate the EXACT persistent Fe incident before any operator response. No transaction submitted.'});
      }
      const assessment=await assessIncident({state:before,incident:p.incident,role:p.role,previewActions:runtime.previewActions,previewIncidentActions:runtime.previewIncidentActions});
      const selected=assessment.options.find(x=>x.id===strategy);
      if(!selected||selected.status!=='ready'||selected.digest!==digest) {
        return reply(res,409,{error:'Selected incident response is stale, unverified, or no longer authorized. No transaction submitted.'});
      }
      // Fail closed if the Fe-specific preview no longer attests every
      // aspect of the incident. The transaction repeats these assertions.
      const incidentCheck=await runtime.previewIncidentActions({
        expectedVersion:BigInt(before.version),
        steps:selected.steps.map(x=>({opcode:BigInt(x.opcode),amount:BigInt(x.amount)})),
        target:selected.target,incident:p.incident,role:p.role,
      });
      if(!incidentCheck.eligible || ['a','b','c'].some(k=>incidentCheck.final[k]!==selected.target[k])) {
        return reply(res,409,{error:'Fe rejected the incident objective or plan at preflight. No transaction submitted.'});
      }
      const tx=await runtime.transactIncidentActions({
        expectedVersion:BigInt(before.version),
        steps:selected.steps.map(x=>({opcode:BigInt(x.opcode),amount:BigInt(x.amount)})),
        target:selected.target,incident:p.incident,role:p.role,
      });
      const after=await runtime.snapshot();
      if(tx.success) {
        if(BigInt(after.version)!==BigInt(before.version)+1n || ['a','b','c'].some(k=>after[k]!==selected.target[k])) {
          throw Error('INCIDENT_FE_GOAL_COMMIT_MISMATCH');
        }
      } else if(JSON.stringify(protectedFields(before))!==JSON.stringify(protectedFields(after))) {
        throw Error('INCIDENT_FE_REVERT_CHANGED_STORAGE');
      }
      const entry=audit.append({
        kind:'transaction',operation:'incident',outcome:tx.success?'committed':'rejected',
        role:p.role,sender:tx.sender,txHash:tx.transactionHash,nonce:tx.nonce,
        incident:p.incident,strategy:strategy,objective:`${assessment.reason} / ${selected.title}`,
        target:selected.target,planFingerprint:selected.goalFingerprint,
        incidentFingerprint:selected.digest,
        proposal:{expectedVersion:before.version,steps:selected.steps},
        fePreviewFinal:selected.target,stageMasks:selected.stageMasks,
        operationError:selected.operationError,policyMask:selected.feMask,
        feIncidentMask:incidentCheck.incidentMask,feIncidentGoalMatches:incidentCheck.goalMatches,
        feIncidentPreviewSource:incidentCheck.from,incidentEnforcement:'Fe commitIncidentActions()',
        authorized:selected.authorized,before:fields(before),after:fields(after),
        protectedBefore:protectedFields(before),protectedAfter:protectedFields(after),
        gasSpent:tx.gasSpent,evmException:tx.error,rejectionCategory:tx.success?null:'EVM_REVERT',
        incidentMetrics:selected.metrics,
      });
      return reply(res,200,{
        result:{...tx,rejectionCategory:entry.event.rejectionCategory},
        strategy:selected.id,assessmentDigest:selected.digest,
        state:after,history:audit.list({session:'current',limit:6}),audit:audit.status(),
      });
    });
  }
  if (pathname === '/api/actions/preview') {
    const p = parseActions(data);
    const role = roleOf(data);
    return serialized(async () => reply(res, 200, {
      preview: await runtime.previewActions({...p,role}),
    }));
  }
  if (pathname === '/api/actions/commit') {
    const p = parseActions(data);
    const role = roleOf(data);
    return serialized(async () => {
      const before = await runtime.snapshot();
      const preflight = await runtime.previewActions({...p,role});
      // Always submit the transaction, including invalid proposals, so
      // rejected attempts have actual local EVM receipts and gas evidence.
      const result = await runtime.transactActions({...p,role});
      const after = await runtime.snapshot();
      if (result.success) {
        if (preflight.mask !== 0 || preflight.operationError !== 0 || !preflight.authorized ||
            BigInt(after.version) !== BigInt(before.version)+1n ||
            ['a','b','c'].some(k => after[k] !== preflight.final[k])) {
          throw Error('ACTIONS_SUCCESS_STATE_MISMATCH');
        }
      } else if (JSON.stringify(protectedFields(after)) !== JSON.stringify(protectedFields(before))) {
        throw Error('ACTIONS_REVERT_STATE_MISMATCH');
      }
      const entry = audit.append({
        kind:'transaction',operation:'actions',
        outcome:result.success?'committed':'rejected',
        role,sender:result.sender,txHash:result.transactionHash,nonce:result.nonce,
        proposal:actionFields(p),fePreviewFinal:preflight.final,
        stageMasks:preflight.stageMasks,operationError:preflight.operationError,
        before:fields(before),after:fields(after),
        protectedBefore:protectedFields(before),protectedAfter:protectedFields(after),
        policyMask:preflight.mask,authorized:preflight.authorized,
        rejectionCategory:result.success?null:rejectionCategory(preflight),
        gasSpent:result.gasSpent,evmException:result.error,
      });
      return reply(res,200,{
        result:{...result,rejectionCategory:entry.event.rejectionCategory},
        state:after,history:audit.list({session:'current',limit:6}),audit:audit.status(),
      });
    });
  }
  if (pathname === '/api/migration/preview') {
    const p = parseMigration(data);
    const role = roleOf(data);
    return serialized(async () => reply(res, 200, {
      preview: await runtime.previewMigration({...p,role}),
    }));
  }
  if (pathname === '/api/migration/commit') {
    const p = parseMigration(data);
    const role = roleOf(data);
    return serialized(async () => {
      const before = await runtime.snapshot();
      const preflight = await runtime.previewMigration({...p,role});
      const result = await runtime.transactMigration({...p,role});
      const after = await runtime.snapshot();
      if (result.success) {
        if (preflight.mask !== 0 || !preflight.authorized ||
            BigInt(after.version) !== BigInt(before.version) + 1n ||
            ['a','b','c'].some(k => after[k] !== preflight.final[k])) {
          throw Error('MIGRATION_SUCCESS_STATE_MISMATCH');
        }
      } else if (JSON.stringify(protectedFields(after)) !== JSON.stringify(protectedFields(before))) {
        throw Error('MIGRATION_REVERT_STATE_MISMATCH');
      }
      const entry = audit.append({
        kind:'transaction', operation:'migration',
        outcome:result.success?'committed':'rejected',
        role,sender:result.sender,txHash:result.transactionHash,nonce:result.nonce,
        proposal:migrationFields(p),
        fePreviewFinal:preflight.final,
        stageMasks:preflight.stageMasks,
        before:fields(before),after:fields(after),
        protectedBefore:protectedFields(before),protectedAfter:protectedFields(after),
        policyMask:preflight.mask,authorized:preflight.authorized,
        rejectionCategory:result.success?null:rejectionCategory(preflight),
        gasSpent:result.gasSpent,evmException:result.error,
      });
      return reply(res, 200, {
        result:{...result,rejectionCategory:entry.event.rejectionCategory},
        state:after,history:audit.list({session:'current',limit:6}),audit:audit.status(),
      });
    });
  }
  if (pathname === '/api/commit') {
    const p = parseProposal(data);
    const role = roleOf(data);
    return serialized(async () => {
      const before = await runtime.snapshot();
      const preflight = await runtime.preview({ ...p, role });
      const result = await runtime.transact({ ...p, role });
      const after = await runtime.snapshot();
      if (result.success) {
        if (BigInt(after.version) !== BigInt(before.version) + 1n ||
            [after.a,after.b,after.c].some((v,i) => v !== String([p.a,p.b,p.c][i]))) {
          throw Error('EVM_SUCCESS_STATE_MISMATCH');
        }
      } else if (JSON.stringify(protectedFields(after)) !== JSON.stringify(protectedFields(before))) {
        throw Error('EVM_REVERT_STATE_MISMATCH');
      }
      const entry = audit.append({
        kind: 'transaction', operation:'direct', outcome: result.success ? 'committed' : 'rejected',
        role, sender: result.sender, txHash: result.transactionHash, nonce: result.nonce,
        proposal: proposalFields(p), before: fields(before), after: fields(after),
        protectedBefore:protectedFields(before),protectedAfter:protectedFields(after),
        policyMask: preflight.mask, authorized: preflight.authorized,
        rejectionCategory: result.success ? null : rejectionCategory(preflight),
        gasSpent: result.gasSpent,
        evmException: result.error,
      });
      return reply(res, 200, {
        result: { ...result, rejectionCategory: entry.event.rejectionCategory },
        state: after, history: audit.list({session:'current',limit:6}), audit: audit.status(),
      });
    });
  }
  return reply(res, 404, { error: 'Unknown API endpoint' });
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${host}:${port}`);
    if (url.pathname.startsWith('/api/guard/')) return await guardApi(req,res,url.pathname);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url.pathname);
    if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, { error: 'Method not allowed' });
    const target = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = resolve(publicRoot, `.${target}`);
    if (file !== publicRoot && !file.startsWith(publicRoot + sep)) return reply(res, 403, { error: 'Invalid path' });
    let content;
    try { content = readFileSync(file); }
    catch (err) {
      if (err.code === 'ENOENT' || err.code === 'EISDIR') return reply(res, 404, {error:'Static asset not found'});
      throw err;
    }
    res.writeHead(200, {
      'Content-Type': mime[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    });
    if (req.method === 'HEAD') return res.end();
    return res.end(content);
  } catch (err) {
    console.error('[covenant]', err.message);
    if (!res.headersSent) return reply(res, err instanceof SyntaxError || /expected|Content-Type|Request too large|Invalid|Unknown role|demo role|Migration requires|Step [0-9]+|Requested reserve|Affected market|input safety domain|Unknown incident|GUARD_/.test(err.message) ? 400 : 500, { error: err.message });
    res.end();
  }
}).listen(port, host, () => {
  console.log(`\nCOVENANT_LOCAL_EVM=READY`);
  console.log(`OPEN_BROWSER=http://${host}:${port}`);
  console.log(`FE_CONTRACT=${runtime.details.address}`);
  console.log(`ALLOCATION_AUTHORITY=${legacyMode?'LEGACY_TEST_FIXTURE':'AllocationFlagship::Guard3'}`);
  console.log(`SINGLE_ALLOCATION_STATE=${legacyMode?'NO_TEST_FIXTURE':'YES'}`);
  console.log(`GUARD_EVM=READY`);
  console.log(`GUARD_ALLOCATION_CONTRACT=${guardRuntime.details.contracts.allocation.address}`);
  console.log(`GUARD_GOVERNANCE_CONTRACT=${guardRuntime.details.contracts.governance.address}`);
  console.log(`GUARD_UI=http://${host}:${port}/guard.html`);
  console.log(`AUDIT_JOURNAL=${audit.path}`);
  console.log(`AUDIT_PREVIOUS_ENTRIES=${audit.status().entries - 1}`);
  console.log('NO_REAL_WALLET=YES');
  console.log('NO_PUBLIC_CHAIN=YES\n');
});
