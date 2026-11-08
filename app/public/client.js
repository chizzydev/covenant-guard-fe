// Covenant Control v1.6 browser. No policy decisions are implemented here:
// the mask and authorization always come from compiled Fe EVM execution.
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const fmt = (value) => BigInt(value).toLocaleString('en-US');
const brief = (value) => `${value.slice(0, 10)}…${value.slice(-8)}`;
const rules = [1, 2, 4, 8, 16, 32];
const pageNames = { desk: 'Configuration desk', migration: 'Migration studio', operations: 'Operations studio', planner: 'Goal planner', incident:'Incident response', catalog: 'Policy catalog', history: 'Local EVM history' };
let currentState = null;
let lastPreview = null;
let lastAudit = null;
let historyCache = [];
let debounceHandle;
let previewSequence = 0;
let busy = false;
let migrationPreview = null;
let migrationDebounce;
let migrationSequence = 0;
let migrationBusy = false;
let opsPreview = null;
let opsDebounce;
let opsSequence = 0;
let opsBusy = false;
let generatedGoalPlan = null;
let plannerSequence = 0;
let plannerBusy = false;
let incidentAssessment = null;
let incidentSequence = 0;
let incidentBusy = false;
let selectedIncidentStrategy = null;
const policyReasonLabels = {1:'Global capacity',2:'Market ceiling',4:'Reserve floor',8:'Paired exposure',16:'Stale configuration version',32:'Input ceiling'};
const actionErrorLabels = {1:'Unknown operation opcode',2:'Invalid or zero quantity',3:'Cannot transfer to the same market',4:'Not enough capacity in source market',5:'Insufficient unallocated capacity; retire before issuing',6:'Required market allocation does not match',7:'Destination exceeds the input safety ceiling'};
const marketNames = ['Core','Supporting','Satellite'];
function describeAction(step) {
  const opcode = Number(step.opcode);
  const amount = String(step.amount);
  if (opcode < 9) return `Move ${amount} ${marketNames[Math.floor(opcode/3)]} → ${marketNames[opcode%3]}`;
  if (opcode < 12) return `Retire ${amount} from ${marketNames[opcode-9]}`;
  if (opcode < 15) return `Issue ${amount} to ${marketNames[opcode-12]}`;
  if (opcode < 18) return `Require ${marketNames[opcode-15]} = ${amount}`;
  return `Unknown opcode ${opcode} (${amount})`;
}
function policyReasons(mask) {
  return rules.filter(bit => (mask & bit) !== 0).map(bit => policyReasonLabels[bit]);
}

async function api(route, options = {}) {
  const response = await fetch(route, { ...options, headers: options.body ? { 'Content-Type': 'application/json' } : {} });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function proposal() {
  const values = ['a','b','c'].map(n => $(`#${n}Input`).value.trim());
  if (values.some(v => !/^(0|[1-9][0-9]*)$/.test(v))) throw new Error('Use nonnegative whole numbers in each market.');
  if (values.some(v => v.length > 20)) throw new Error('Values may contain no more than 20 digits.');
  return { expectedVersion: currentState.version, a: values[0], b: values[1], c: values[2], role: $('#actorSelect').value };
}

function setMessage(text, kind = '') {
  $('#resultMessage').textContent = text;
  $('#resultMessage').className = `result-message ${kind}`;
}

function switchPage(name) {
  if (!pageNames[name]) return;
  for (const page of Object.keys(pageNames)) {
    $(`#${page}View`).hidden = page !== name;
  }
  for (const button of $$('.sidebar .nav')) {
    const active = button.dataset.page === name;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current','page');
    else button.removeAttribute('aria-current');
  }
  $('#pageTitle').textContent = pageNames[name];
  if (name === 'history') loadHistory();
  if (name === 'migration') refreshMigrationPreview();
  if (name === 'operations') refreshOpsPreview();
  if (name === 'planner' && !generatedGoalPlan && currentState) plannerGenerate();
  if (name === 'incident' && !incidentAssessment && currentState) incidentAssess();
  window.scrollTo(0, 0);
}

function renderState(state, runtime, history, audit) {
  if(currentState && (state.version!==currentState.version || ['a','b','c'].some(k=>state[k]!==currentState[k]))) {plannerInvalidate();incidentInvalidate();}
  currentState = state;
  const incident = state.incident;
  const phaseLabel = incident ? ['INACTIVE','RECOVERING','CONTAINED'][Number(incident.phase)] : 'LEGACY TEST';
  $('#guardianObjectiveStatus').textContent = incident && Number(incident.phase)!==0
    ? `Fe ${phaseLabel} · ID ${incident.id} · market ${incident.market} maximum ${incident.maximum} · minimum reserve ${incident.reserveMinimum} · deficits (${state.deficits.exposure}, ${state.deficits.reserve}).`
    : 'No stored incident. Activate an objective explicitly as guardian; ordinary operator responses cannot establish one.';
  $('#incidentGuardianActivateBtn').disabled = !incident || Number(incident.phase)!==0;
  $('#headerVersion').textContent = state.version;
  $('#versionValue').textContent = state.version;
  $('#budgetValue').textContent = fmt(state.budget);
  $('#committedValue').textContent = fmt(BigInt(state.a) + BigInt(state.b) + BigInt(state.c));
  $('#reserveValue').textContent = fmt(BigInt(state.budget) - BigInt(state.a) - BigInt(state.b) - BigInt(state.c));
  $('#capA').textContent = fmt(state.capA);
  $('#capB').textContent = fmt(state.capB);
  $('#capC').textContent = fmt(state.capC);
  $('#floorValue').textContent = fmt(state.reserveFloor);
  $('#proposalBudget').textContent = fmt(state.budget);
  $('#contractShort').textContent = brief(runtime.address);
  $('#contractShort').title = runtime.address;
  $('#catalogVersion').textContent = state.version;
  $('#catalogOperator').textContent = state.operator;
  $('#catalogBudget').textContent = `${fmt(state.budget)} units`;
  $('#catalogCaps').textContent = `Core ${fmt(state.capA)} · Supporting ${fmt(state.capB)} · Satellite ${fmt(state.capC)}`;
  $('#catalogReserveFloor').textContent = `${fmt(state.reserveFloor)} units`;
  $('#catalogExpected').textContent = `Expected current v${state.version}`;
  $('#catalogInputCeiling').textContent = `${fmt(state.inputCeiling)} units per input`;
  $('#catalogPaired').textContent = `Core ≤ ${state.pairedMultiplier} × Supporting`;
  $('#pairMultiplier').textContent = state.pairedMultiplier;
  $('#migrationFromVersion').textContent = state.version;
  $('#migrationToVersion').textContent = String(BigInt(state.version) + 1n);
  $('#opsBefore').textContent = `${fmt(state.a)} / ${fmt(state.b)} / ${fmt(state.c)}`;
  $('#plannerBefore').textContent = `${fmt(state.a)} / ${fmt(state.b)} / ${fmt(state.c)}`;
  $('#plannerCurrentVersion').textContent = state.version;
  $('#incidentCurrent').textContent = `${fmt(state.a)} / ${fmt(state.b)} / ${fmt(state.c)}`;
  $('#incidentCurrentReserve').textContent = `${fmt(BigInt(state.budget)-BigInt(state.a)-BigInt(state.b)-BigInt(state.c))} units`;
  $('#incidentVersion').textContent = `v${state.version}`;
  $('#incidentReserve').min = state.reserveFloor;
  if (history) renderCompactHistory(history);
  if (audit) lastAudit = audit;
}

function renderCompactHistory(history) {
  const el = $('#historyEntries');
  el.replaceChildren();
  if (!history.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-history';
    empty.textContent = 'No transactions yet. Your sandbox transactions will appear here.';
    el.append(empty);
    return;
  }
  for (const item of history.slice(0, 6)) {
    const row = document.createElement('div'); row.className = `entry ${item.outcome}`;
    const symbol = document.createElement('div'); symbol.className = 'entry-symbol'; symbol.textContent = item.outcome === 'committed' ? '✓' : '×';
    const details = document.createElement('div'); details.className = 'entry-details';
    const strong = document.createElement('strong');
    strong.textContent = item.outcome === 'committed' ? `Policy v${item.after.version} committed` : `Rejected · ${item.rejectionCategory}`;
    const small = document.createElement('small');
    const isGuard = item.operation?.startsWith('guard_');
    small.textContent = isGuard ? `${item.role} · ${item.domain} · ${item.operation.slice(6)} · ${fmt(item.gasSpent)} gas`
      : item.operation === 'migration'
      ? `${item.role} · ${item.proposal.steps.length}-step atomic migration · ${fmt(item.gasSpent)} gas`
      : (item.operation === 'actions' || item.operation === 'planner' || item.operation === 'incident')
      ? `${item.role} · ${item.proposal.steps.length} ${item.operation === 'incident' ? 'incident response operations' : item.operation === 'planner' ? 'goal-attested operations' : 'semantic operations'} · ${fmt(item.gasSpent)} gas`
      : `${item.role} · ${item.proposal.a} / ${item.proposal.b} / ${item.proposal.c} · ${fmt(item.gasSpent)} gas`;
    const tx = document.createElement('span'); tx.className = 'entry-hash mono'; tx.textContent = brief(item.txHash); tx.title = item.txHash;
    details.append(strong, small, tx);
    const time = document.createElement('time'); time.textContent = new Date(item.time).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    row.append(symbol, details, time); el.append(row);
  }
}

function makeText(parent, tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = String(text);
  if (className) element.className = className;
  parent.append(element);
  return element;
}

function renderFullHistory() {
  const currentOnly = $('#historyFilter').value === 'current';
  const history = currentOnly ? historyCache.filter(x => x.sessionId === lastAudit?.sessionId) : historyCache;
  const el = $('#historyTimeline'); el.replaceChildren();
  $('#auditCount').textContent = `${history.length} transactions`;
  $('#auditStatus').textContent = `${lastAudit?.entries ?? 0} journal entries · Verified on startup`;
  $('#activeSessionLabel').textContent = `Active local session ${lastAudit?.sessionId?.slice(0, 8) || '—'} · Restarts reset EVM state`;
  if (!history.length) {
    makeText(el,'div','No transactions match this session filter. Submit a change from the Configuration desk.', 'empty-history');
    return;
  }
  for (const item of history) {
    const box = document.createElement('article'); box.className = 'audit-entry';
    const head = document.createElement('div'); head.className = 'audit-head';
    const isGuard = item.operation?.startsWith('guard_');
    makeText(head, 'strong', `#${item.index} · ${item.outcome === 'committed' ? 'Committed' : 'Rejected'} · ${isGuard ? `${item.domain} Guard action · ` : item.operation === 'migration' ? 'Staged migration · ' : item.operation === 'actions' ? 'Semantic operations · ' : item.operation === 'planner' ? 'Goal-attested plan · ' : item.operation === 'incident' ? 'Incident response · ' : ''}${item.role}`);
    makeText(head, 'span', item.outcome === 'committed' ? 'EVM SUCCESS' : item.rejectionCategory || 'EVM REVERT', `audit-outcome ${item.outcome}`);
    box.append(head);
    const meta = makeText(box, 'div', `${new Date(item.time).toLocaleString()} · ${fmt(item.gasSpent)} gas · Session ${item.sessionId.slice(0,8)}${item.sessionId !== lastAudit?.sessionId ? ' (prior session)' : ''}`, 'audit-meta');
    const hash = document.createElement('div'); hash.className = 'audit-meta';
    makeText(hash,'span','Transaction: ');
    makeText(hash,'code',item.txHash);
    box.append(hash);
    const transition = document.createElement('div'); transition.className = 'audit-transition';
    const beforeCoordinates = item.before.a===undefined ? [item.before.x,item.before.y,item.before.z] : [item.before.a,item.before.b,item.before.c];
    const afterCoordinates = item.after.a===undefined ? [item.after.x,item.after.y,item.after.z] : [item.after.a,item.after.b,item.after.c];
    for (const [label, value] of [
      ['Before', `v${item.before.version} · ${beforeCoordinates.join(' / ')}`],
      ['Proposed', isGuard ? `${item.domain} / ${item.operation.slice(6)} / Fe-owned signed EVM operation` : item.operation === 'migration'
        ? `v${item.proposal.expectedVersion} → ${(item.proposal.steps || []).map(s => ['Core','Supporting','Satellite'][Number(s.market)] + '=' + s.value).join(' → ')}`
        : (item.operation === 'actions' || item.operation === 'planner' || item.operation === 'incident')
        ? `v${item.proposal.expectedVersion} → ${(item.proposal.steps || []).map(describeAction).join(' → ')}`
        : `v${item.proposal.expectedVersion} → ${item.proposal.a} / ${item.proposal.b} / ${item.proposal.c}`],
      ['After', `v${item.after.version} · ${afterCoordinates.join(' / ')}`],
    ]) {
      const cell = document.createElement('div'); makeText(cell,'span',label); makeText(cell,'strong',value); transition.append(cell);
    }
    box.append(transition);
    if (item.operation === 'migration' || item.operation === 'actions' || item.operation === 'planner' || item.operation === 'incident') {
      const intermediate = item.stageMasks || [];
      makeText(box, 'div', `Fe stage masks: ${intermediate.join(' → ')} · Fe candidate: ${item.fePreviewFinal?.a} / ${item.fePreviewFinal?.b} / ${item.fePreviewFinal?.c}`, 'audit-meta');
    }
    if (item.operation === 'actions' || item.operation === 'planner' || item.operation === 'incident') {
      const error = Number(item.operationError || 0);
      makeText(box, 'div', error
        ? `FE OPERATION BLOCKED at step ${Math.floor(error / 16)}: ${actionErrorLabels[error % 16] || 'Unknown operation failure'} (error ${error})`
        : `FE OPERATIONS VALID · ${item.proposal.steps.map(describeAction).join(' · ')}`, 'audit-meta');
    }
    if (item.operation === 'planner') {
      makeText(box,'div',`GOAL: ${item.objective} · REQUIRED FINAL ${item.target.a} / ${item.target.b} / ${item.target.c}`,'audit-meta');
      makeText(box,'div',`GOAL-ATTESTED Fe COMMIT · Plan fingerprint ${item.planFingerprint}`,'audit-meta');
    }
    if (item.operation === 'incident') {
      makeText(box,'div',`INCIDENT: ${marketNames[Number(item.incident.market)]} exposure ≤ ${item.incident.maximum} · Requested reserve ≥ ${item.incident.reserve} · Strategy ${item.strategy}`, 'audit-meta');
      makeText(box,'div',`FE-ATTESTED RESPONSE · Exact target ${item.target.a} / ${item.target.b} / ${item.target.c} · Incident fingerprint ${item.incidentFingerprint}`, 'audit-meta');
      makeText(box,'div',`RESPONSE TRADEOFF · ${item.incidentMetrics.allocated} active · ${item.incidentMetrics.reserve} unallocated · ${item.incidentMetrics.retired} retired`, 'audit-meta');
    }
    makeText(box, 'div', isGuard
      ? `Stored incident: ${JSON.stringify(item.after.incident)} · Deficits: ${JSON.stringify(item.after.deficits)} · Journal #${item.index}`
      : `Fe policy mask ${item.policyMask} · Signer ${item.authorized ? 'authorized' : 'unauthorized'} · Nonce ${item.nonce} · Journal #${item.index}`, 'audit-meta');
    el.append(box);
  }
}

async function loadHistory() {
  try {
    const data = await api('/api/history');
    historyCache = data.history;
    lastAudit = data.audit;
    renderFullHistory();
  } catch (error) {
    $('#auditStatus').textContent = `Audit unavailable: ${error.message}`;
  }
}

function renderChart(draft) {
  const budget = BigInt(currentState.budget);
  const vals = ['a','b','c'].map(k => BigInt(draft[k]));
  const total = vals.reduce((x,y)=>x+y,0n);
  const displayTotal = total > budget ? total : budget;
  for (let i=0;i<3;i++) {
    const name = 'ABC'[i];
    const share = displayTotal === 0n ? 0 : Number(vals[i] * 10000n / displayTotal) / 100;
    $(`#segment${name}`).style.width = `${Math.max(0, Math.min(100, share))}%`;
    const cap = BigInt(currentState[`cap${name}`]);
    const width = cap === 0n ? 100 : Number(vals[i] * 10000n / cap) / 100;
    $(`#bar${name}`).style.width = `${Math.max(0, Math.min(100, width))}%`;
  }
  const free = displayTotal - total;
  $('#segmentFree').style.width = `${displayTotal === 0n ? 0 : Number(free * 10000n / displayTotal) / 100}%`;
}

function renderPreview(result, draft) {
  lastPreview = result;
  const policyValid = result.allowed;
  const eligible = result.eligible;
  $('#previewStatus').className = `status ${eligible?'good':'bad'}`;
  $('#previewStatus').textContent = eligible ? 'READY TO COMMIT' : !policyValid ? 'POLICY REJECTED' : 'SIGNER BLOCKED';
  $('#proposalTotal').textContent = fmt(result.total);
  $('#newVersion').textContent = `Target v${result.nextVersion}`;
  $('#sourceInfo').textContent = `${result.from} · canCommit() via ${result.role}`;
  const auth = $('#authCheck');
  auth.className = `auth-check ${result.authorized?'ok':'err'}`;
  auth.textContent = result.authorized
    ? '✓ Selected local signer is authorized by Fe canCommit().'
    : '× Selected local signer is NOT authorized by Fe canCommit(). Policy validity alone does not grant permission.';
  for (const bit of rules) {
    const el = $(`.rule[data-rule="${bit}"]`);
    const passes = (result.mask & bit) === 0;
    el.className = `rule ${passes ? 'passed' : 'failed'}`;
    el.querySelector('.rule-sign').textContent = passes ? '✓' : '×';
  }
  renderChart(draft);
  $('#commitBtn').disabled = busy || !eligible;
  $('#proveBtn').disabled = busy || eligible;
  $('#proveBtn').textContent = !result.authorized && policyValid
    ? 'Attempt unauthorized transaction anyway'
    : 'Attempt the rejected commit anyway';
  if (eligible) setMessage('Policy and signer checks passed. Commit will be rechecked on-chain.', 'ok');
  else if (!policyValid) setMessage('Fe policy rejected this draft. You can try a transaction to demonstrate atomic rollback.', 'err');
  else setMessage('The selected signer lacks Fe contract authority. You can submit a rejected local transaction as proof.', 'err');
}

async function refreshPreview() {
  if (!currentState || busy) return;
  const request = ++previewSequence;
  $('#previewStatus').className = 'status loading';
  $('#previewStatus').textContent = 'EVALUATING';
  $('#commitBtn').disabled = true;
  $('#proveBtn').disabled = true;
  lastPreview = null;
  try {
    const draft = proposal();
    const data = await api('/api/preview', { method:'POST', body:JSON.stringify(draft) });
    if (request !== previewSequence) return;
    renderPreview(data.preview, draft);
  } catch (error) {
    if (request !== previewSequence) return;
    $('#previewStatus').textContent = 'INVALID INPUT';
    $('#previewStatus').className = 'status bad';
    setMessage(error.message, 'err');
  }
}

function updateInputs(chosen) {
  for (const k of ['a','b','c']) $(`#${k}Input`).value = String(chosen[k]);
  $$('.preset').forEach(button => button.classList.toggle('active', button.dataset.preset === chosen.name));
  refreshPreview();
}

async function performCommit(force) {
  if (busy || !currentState) return;
  if (!force && (!lastPreview || !lastPreview.eligible)) return;
  let body;
  try { body = proposal(); }
  catch (error) { setMessage(error.message, 'err'); return; }
  busy = true;
  ++previewSequence;
  let finalNotice = null;
  $('#commitBtn').disabled = true;
  $('#proveBtn').disabled = true;
  setMessage('Submitting a signed synthetic transaction inside the local EVM…');
  try {
    const data = await api('/api/commit', { method:'POST', body:JSON.stringify(body) });
    renderState(data.state, {address:$('#contractShort').title}, data.history, data.audit);
    if (data.result.success) {
      finalNotice = { text: `Committed policy v${data.state.version}. Tx ${brief(data.result.transactionHash)} · ${fmt(data.result.gasSpent)} gas.`, kind: 'ok' };
      for (const k of ['a','b','c']) $(`#${k}Input`).value = data.state[k];
    } else {
      finalNotice = { text: `Fe EVM rejected ${data.result.rejectionCategory}. State remains v${data.state.version}. Tx ${brief(data.result.transactionHash)}.`, kind: 'err' };
    }
    await loadHistory();
  } catch(error) { finalNotice = { text: error.message, kind: 'err' }; }
  finally {
    busy = false;
    await refreshPreview();
    if (finalNotice) setMessage(finalNotice.text, finalNotice.kind);
  }
}

async function load() {
  try {
    const data = await api('/api/state');
    renderState(data.state, data.runtime, data.history, data.audit);
    for (const k of ['a','b','c']) $(`#${k}Input`).value = data.state[k];
    await refreshPreview();
    await refreshMigrationPreview();
    await refreshOpsPreview();
  } catch(error) {
    $('#previewStatus').textContent = 'OFFLINE';
    $('#previewStatus').className = 'status bad';
    setMessage(`Could not initialize the Fe EVM: ${error.message}`, 'err');
  }
}

// --- Atomic migration workflow. Policy evaluation is always performed by Fe. ---
function migrationPlan() {
  if (!currentState) throw new Error('EVM state not loaded');
  const count = Number($('#migrationCount').value);
  if (!Number.isInteger(count) || count < 1 || count > 3) throw new Error('Invalid number of steps');
  const steps = [];
  for (let i=1;i<=count;i++) {
    const market = $(`#stage${i}Market`).value;
    const value = $(`#stage${i}Value`).value.trim();
    if (!/^[012]$/.test(market)) throw new Error(`Step ${i} has an invalid market`);
    if (!/^(0|[1-9][0-9]{0,19})$/.test(value)) throw new Error(`Step ${i}: use nonnegative whole numbers (max 20 digits)`);
    steps.push({market,value});
  }
  return { expectedVersion: currentState.version, steps, role: $('#migrationActor').value };
}
function migrationMessage(message,kind='') {
  $('#migrationMessage').textContent = message;
  $('#migrationMessage').className = `result-message ${kind}`;
}
function renderMigrationPreview(result, draft) {
  migrationPreview = result;
  $('#migrationPreviewStatus').className = `status ${result.eligible?'good':'bad'}`;
  $('#migrationPreviewStatus').textContent = result.eligible?'FINAL STATE SAFE':!result.allowed?'FINAL STATE BLOCKED':'SIGNER BLOCKED';
  $('#migrationFinal').textContent = `${fmt(result.final.a)} / ${fmt(result.final.b)} / ${fmt(result.final.c)}`;
  $('#migrationTotal').textContent = (result.mask & 32)
    ? 'Final total unavailable · input ceiling exceeded'
    : `${fmt(result.total)} units total · ${fmt(result.remaining)} unallocated`;
  $('#migrationToVersion').textContent = result.nextVersion;
  for (let i=1;i<=3;i++) {
    const node = $(`#stage${i}Verdict`);
    if (i>draft.steps.length) continue;
    const mask = result.stageMasks[i-1];
    const failures = policyReasons(mask);
    const last = i===draft.steps.length;
    node.className = `stage-verdict ${mask===0?'safe':last?'final-bad':'unsafe'}`;
    node.textContent = !mask ? `FE: STATE VALID${last?' · FINAL':''}` : `${last?'FINAL BLOCKED':'INTERMEDIATE VIOLATION (ALLOWED)'} · ${failures.join(', ')}`;
  }
  const failedReasons = policyReasons(result.mask);
  const box = $('#migrationFinalFlags');box.replaceChildren();
  if (!failedReasons.length) makeText(box,'strong','✓ Every final policy rule passes on Fe EVM.');
  else for (const reason of failedReasons) makeText(box,'span',`× ${reason}`,'bad-reason');
  const auth = $('#migrationSignerCheck');
  auth.className = `auth-check ${result.authorized?'ok':'err'}`;
  auth.textContent = result.authorized
    ? '✓ Fe canCommit(): the selected local signer is authorized.'
    : '× Fe canCommit(): the selected local signer cannot commit.';
  $('#migrationCommitBtn').disabled = migrationBusy || !result.eligible;
  $('#migrationRejectBtn').disabled = migrationBusy || result.eligible;
  $('#migrationCommitBtn').textContent = `Commit ${draft.steps.length}-step migration →`;
  if (result.eligible) migrationMessage('Final state and signer are valid. All steps will commit atomically after Fe scope finalization.','ok');
  else migrationMessage('Commit is blocked by the final Fe verdict or signer. You can still submit a rejected sandbox transaction for proof.','err');
}
async function refreshMigrationPreview() {
  if (!currentState || migrationBusy) return;
  const req = ++migrationSequence;
  migrationPreview = null;
  $('#migrationCommitBtn').disabled = true;
  $('#migrationRejectBtn').disabled = true;
  $('#migrationPreviewStatus').className = 'status loading';
  $('#migrationPreviewStatus').textContent = 'EVALUATING';
  try {
    const plan = migrationPlan();
    for (let i=1;i<=3;i++) $(`.migration-step[data-stage="${i}"]`).hidden = i>plan.steps.length;
    const {preview} = await api('/api/migration/preview',{method:'POST',body:JSON.stringify(plan)});
    if (req!==migrationSequence) return;
    renderMigrationPreview(preview,plan);
  } catch(error) {
    if (req!==migrationSequence) return;
    $('#migrationPreviewStatus').className = 'status bad';
    $('#migrationPreviewStatus').textContent = 'INVALID INPUT';
    migrationMessage(error.message,'err');
  }
}
function migrationInvalidate() {
  ++migrationSequence;
  migrationPreview = null;
  $('#migrationCommitBtn').disabled = true;
  $('#migrationRejectBtn').disabled = true;
  $('#migrationPreviewStatus').className = 'status loading';
  $('#migrationPreviewStatus').textContent = 'DRAFT CHANGED';
  const count = Number($('#migrationCount').value);
  for (let i=1;i<=3;i++) $(`.migration-step[data-stage="${i}"]`).hidden = i>count;
  clearTimeout(migrationDebounce);
  migrationDebounce = setTimeout(refreshMigrationPreview,180);
}
function loadMigrationPreset(which) {
  const examples = {
    recover: [{market:'0',value:'550'},{market:'1',value:'200'},{market:'0',value:'350'}],
    reject: [{market:'0',value:'550'},{market:'1',value:'200'},{market:'0',value:'500'}],
    steady: [{market:'0',value:'350'},{market:'1',value:'350'},{market:'2',value:'150'}],
  };
  const choice = examples[which];
  if (!choice) return;
  $('#migrationCount').value = '3';
  choice.forEach((step, i) => {
    $(`#stage${i+1}Market`).value = step.market;
    $(`#stage${i+1}Value`).value = step.value;
  });
  $$('.mig-preset').forEach(b=>b.classList.toggle('active',b.dataset.migPreset===which));
  migrationInvalidate();
}
async function migrationCommit(force) {
  if (!currentState || migrationBusy || (!force && !migrationPreview?.eligible)) return;
  let plan;
  try { plan = migrationPlan(); } catch(e) { migrationMessage(e.message,'err'); return; }
  migrationBusy = true;
  ++migrationSequence;
  $('#migrationCommitBtn').disabled = true;
  $('#migrationRejectBtn').disabled = true;
  migrationMessage('Executing all steps as one signed local Fe EVM transaction…');
  let notice;
  try {
    const data = await api('/api/migration/commit',{method:'POST',body:JSON.stringify(plan)});
    renderState(data.state,{address:$('#contractShort').title},data.history,data.audit);
    if (data.result.success) {
      notice = {text:`Atomic migration committed at v${data.state.version}. ${brief(data.result.transactionHash)} · ${fmt(data.result.gasSpent)} gas.`,kind:'ok'};
      for (const k of ['a','b','c']) $(`#${k}Input`).value = data.state[k];
    } else notice = {text:`Fe rejected ${data.result.rejectionCategory}; ALL stages reverted. Configuration remains v${data.state.version}.`,kind:'err'};
    await loadHistory();
  } catch(error) {notice={text:error.message,kind:'err'};}
  finally {
    migrationBusy = false;
    await refreshMigrationPreview();
    await refreshPreview();
    if (notice) migrationMessage(notice.text,notice.kind);
  }
}

// --- v1.4 semantic operations: Fe is the only authority for validity. ---
function updateActionRow(i) {
  const kind = $(`#opStep${i}Type`).value;
  $(`#opStep${i}FromWrap`).hidden = kind === 'issue';
  $(`#opStep${i}ToWrap`).hidden = kind === 'retire' || kind === 'expect';
  const from = $(`#opStep${i}FromWrap label`);
  from.textContent = kind === 'move' ? 'Source market' : 'Market';
  $(`#opStep${i}AmountLabel`).textContent = kind === 'expect' ? 'Required current allocation (units)' : 'Quantity (units)';
}
function opsPlan() {
  if (!currentState) throw Error('EVM state not ready');
  const count = Number($('#opsCount').value);
  if (!Number.isInteger(count) || count < 1 || count > 3) throw Error('Choose one to three operations');
  const steps = [];
  for (let i=1;i<=count;i++) {
    const kind = $(`#opStep${i}Type`).value;
    const from = Number($(`#opStep${i}From`).value);
    const to = Number($(`#opStep${i}To`).value);
    const amount = $(`#opStep${i}Amount`).value.trim();
    if (!/^(0|[1-9][0-9]{0,19})$/.test(amount)) throw Error(`Operation ${i}: enter a nonnegative integer of at most 20 digits`);
    if (![from,to].every(n => Number.isInteger(n) && n >= 0 && n <= 2)) throw Error('Unknown market selection');
    const opcode = kind === 'move' ? from*3+to
      : kind === 'retire' ? 9+from
      : kind === 'issue' ? 12+to
      : kind === 'expect' ? 15+from : -1;
    if (opcode < 0) throw Error('Invalid operation');
    steps.push({opcode:String(opcode),amount});
  }
  return {expectedVersion:currentState.version,steps,role:$('#opsActor').value};
}
function opsMessage(text,kind='') {
  $('#opsMessage').textContent = text;
  $('#opsMessage').className = `result-message ${kind}`;
}
function renderOpsPreview(result,plan) {
  opsPreview = result;
  const err = result.operationError;
  const failStep = err ? Math.floor(err/16) : 0;
  const failReason = err ? (actionErrorLabels[err%16] || `Error ${err%16}`) : '';
  const status = $('#opsPreviewStatus');
  status.className = `status ${result.eligible?'good':'bad'}`;
  status.textContent = result.eligible ? 'READY FOR ATOMIC COMMIT'
    : err ? 'OPERATION BLOCKED'
    : !result.allowed ? 'FINAL POLICY BLOCKED' : 'SIGNER BLOCKED';
  $('#opsFinalTitle').textContent = err ? `Stopped at operation ${failStep} · partial candidate` : 'Final allocation if committed';
  $('#opsFinal').textContent = `${fmt(result.final.a)} / ${fmt(result.final.b)} / ${fmt(result.final.c)}`;
  $('#opsTotal').textContent = err ? `Operation ${failStep} rejected by Fe before commit`
    : `${fmt(result.total)} units allocated · ${fmt(result.remaining)} unallocated`;
  $('#opsVersion').textContent = `v${result.nextVersion}`;
  for (let i=1;i<=3;i++) {
    const node = $(`#opStep${i}Verdict`);
    if (i>plan.steps.length) continue;
    const mask = result.stageMasks[i-1] || 0;
    if (failStep && i>failStep) {
      node.className = 'stage-verdict pending';node.textContent = 'NOT EXECUTED: earlier operation blocked';
    } else if (failStep === i) {
      node.className = 'stage-verdict final-bad';node.textContent = `FE OPERATION BLOCKED · ${failReason}`;
    } else {
      const reasons = policyReasons(mask);
      const final = i===plan.steps.length;
      node.className = `stage-verdict ${mask===0?'safe':final?'final-bad':'unsafe'}`;
      node.textContent = mask === 0 ? `FE OPERATION VALID · POLICY HEALTHY${final?' · FINAL':''}`
        : `FE OPERATION VALID · ${final?'FINAL POLICY VIOLATION':'INTERMEDIATE POLICY VIOLATION (ALLOWED)'} · ${reasons.join(', ')}`;
    }
  }
  const flags = $('#opsFlags'); flags.replaceChildren();
  if (err) makeText(flags,'span',`× Step ${failStep}: ${failReason}`,'bad-reason');
  const reasons = policyReasons(result.mask);
  for (const reason of reasons) makeText(flags,'span',`× ${reason}`,'bad-reason');
  if (!err && !reasons.length) makeText(flags,'strong','✓ All operations and final policy validated by Fe.');
  const signer = $('#opsSignerCheck');
  signer.className = `auth-check ${result.authorized?'ok':'err'}`;
  signer.textContent = result.authorized ? '✓ Selected local signer is authorized by Fe.' : '× Fe canCommit(): signer lacks authority.';
  $('#opsCommitBtn').disabled = opsBusy || !result.eligible;
  $('#opsRejectBtn').disabled = opsBusy || result.eligible;
  $('#opsCommitBtn').textContent = `Commit ${plan.steps.length} atomic operation${plan.steps.length===1?'':'s'} →`;
  opsMessage(result.eligible ? 'Operation preconditions and final policy pass. One signed Fe EVM transaction will commit the whole plan.'
    : err ? `Fe stopped operation ${failStep}: ${failReason}. A rejected transaction can prove the rollback.`
    : !result.allowed ? 'Operations succeeded, but the final Fe policy rejects the result; no partial commit is possible.'
    : 'Selected signer is unauthorized; policy validity is not permission.',result.eligible?'ok':'err');
}
async function refreshOpsPreview() {
  if (!currentState || opsBusy) return;
  const req = ++opsSequence;
  opsPreview = null;
  $('#opsCommitBtn').disabled = true;$('#opsRejectBtn').disabled = true;
  $('#opsPreviewStatus').className = 'status loading';$('#opsPreviewStatus').textContent = 'EVALUATING';
  try {
    const plan = opsPlan();
    for(let i=1;i<=3;i++) {
      $(`.ops-step[data-op-stage="${i}"]`).hidden = i>plan.steps.length;
      updateActionRow(i);
    }
    const {preview} = await api('/api/actions/preview',{method:'POST',body:JSON.stringify(plan)});
    if(req!==opsSequence) return;
    renderOpsPreview(preview,plan);
  } catch(error) {
    if(req!==opsSequence) return;
    $('#opsPreviewStatus').className = 'status bad';$('#opsPreviewStatus').textContent = 'INVALID DRAFT';
    opsMessage(error.message,'err');
  }
}
function opsInvalidate() {
  ++opsSequence;opsPreview = null;
  $('#opsCommitBtn').disabled = true;$('#opsRejectBtn').disabled = true;
  $('#opsPreviewStatus').className = 'status loading';$('#opsPreviewStatus').textContent = 'DRAFT CHANGED';
  const count = Number($('#opsCount').value);
  for(let i=1;i<=3;i++) {
    $(`.ops-step[data-op-stage="${i}"]`).hidden = i>count;
    updateActionRow(i);
  }
  clearTimeout(opsDebounce);opsDebounce = setTimeout(refreshOpsPreview,180);
}
function setOpsPreset(which) {
  const examples = {
    recycle:[[9,250],[13,250],[3,100]],
    reversed:[[13,250],[9,250],[3,100]],
    unsafe:[[9,250],[13,250],[16,550]],
    conditional:[[15,400],[1,50],[15,350]],
  };
  const chosen = examples[which];if(!chosen) return;
  $('#opsCount').value = '3';
  chosen.forEach(([opcode,amount],index)=>{
    const i=index+1;
    const kind=opcode<9?'move':opcode<12?'retire':opcode<15?'issue':'expect';
    const from=kind==='move'?Math.floor(opcode/3):kind==='retire'?opcode-9:kind==='expect'?opcode-15:0;
    const to=kind==='move'?opcode%3:kind==='issue'?opcode-12:0;
    $(`#opStep${i}Type`).value=kind;
    $(`#opStep${i}From`).value=String(from);$(`#opStep${i}To`).value=String(to);
    $(`#opStep${i}Amount`).value=String(amount);
  });
  $$('.ops-preset').forEach(b=>b.classList.toggle('active',b.dataset.opsPreset===which));
  opsInvalidate();
}
async function opsCommit(force) {
  if(!currentState || opsBusy || (!force && !opsPreview?.eligible)) return;
  let plan;try{plan=opsPlan();}catch(e){opsMessage(e.message,'err');return;}
  opsBusy=true;++opsSequence;
  $('#opsCommitBtn').disabled=true;$('#opsRejectBtn').disabled=true;
  opsMessage('Executing semantic operations with Fe preconditions and guarded finalization…');
  let notice;
  try {
    const data = await api('/api/actions/commit',{method:'POST',body:JSON.stringify(plan)});
    renderState(data.state,{address:$('#contractShort').title},data.history,data.audit);
    if(data.result.success) {
      notice={text:`Atomic operations committed at v${data.state.version}. ${brief(data.result.transactionHash)} · ${fmt(data.result.gasSpent)} gas.`,kind:'ok'};
      for(const k of ['a','b','c']) $(`#${k}Input`).value=data.state[k];
    } else {
      notice={text:`Local Fe EVM rejected ${data.result.rejectionCategory}. Every operation reverted. Version remains v${data.state.version}. Tx ${brief(data.result.transactionHash)}.`,kind:'err'};
    }
    await loadHistory();
  }catch(error){notice={text:error.message,kind:'err'};}
  finally {
    opsBusy=false;await refreshOpsPreview();await refreshMigrationPreview();await refreshPreview();
    if(notice) opsMessage(notice.text,notice.kind);
  }
}

// --- v1.5 goal planner: candidate arithmetic is server-side, verdicts Fe-side. ---
function plannerMessage(text,kind='') {
  $('#plannerMessage').textContent=text;
  $('#plannerMessage').className=`result-message ${kind}`;
}
function plannerMode() {
  const target=$('#plannerKind').value==='target';
  $('#plannerTargetInputs').hidden=!target;
  $('#plannerShiftInputs').hidden=target;
}
function plannerInvalidate() {
  plannerSequence++;
  generatedGoalPlan=null;
  $('#plannerCommitBtn').disabled=true;
  $('#plannerStatus').className='status loading';
  $('#plannerStatus').textContent='REPLAN REQUIRED';
  $('#plannerExplanation').textContent='Generate a fresh Fe-verified plan for the selected objective.';
  $('#plannerExplanation').className='planner-explanation';
  $('#plannerSteps').replaceChildren();
  makeText($('#plannerSteps'),'div','No currently verified plan.','planner-empty');
  $('#plannerTarget').textContent='— / — / —';
  $('#plannerSummary').textContent='Generate a plan from the current Fe configuration.';
  plannerMessage('No transaction submitted.');
}
function plannerGoal() {
  if(!currentState) throw Error('Local Fe state is not initialized');
  const num=(id,positive=false)=>{
    const v=$(id).value.trim();
    if(!/^(0|[1-9][0-9]{0,19})$/.test(v) || (positive && v==='0')) throw Error(`${id.slice(1)}: enter a valid ${positive?'positive':'nonnegative'} whole number (max 20 digits).`);
    return v;
  };
  if($('#plannerKind').value==='target') {
    return {kind:'target',a:num('#plannerTargetA'),b:num('#plannerTargetB'),c:num('#plannerTargetC')};
  }
  if($('#plannerSource').value===$('#plannerDestination').value) throw Error('Choose different source and destination markets.');
  return {kind:'shift',source:$('#plannerSource').value,
    destination:$('#plannerDestination').value,quantity:num('#plannerQuantity',true)};
}
function plannerShow(plan) {
  generatedGoalPlan=plan;
  const ready=plan.status==='ready';
  $('#plannerStatus').className=`status ${ready?'good':plan.status==='already_satisfied'?'good':'bad'}`;
  $('#plannerStatus').textContent=({ready:'READY FOR COMMIT',infeasible:'GOAL INFEASIBLE',unauthorized:'SIGNER BLOCKED',already_satisfied:'ALREADY SATISFIED'})[plan.status]||plan.status.toUpperCase();
  $('#plannerTarget').textContent=`${fmt(plan.target.a)} / ${fmt(plan.target.b)} / ${fmt(plan.target.c)}`;
  $('#plannerSummary').textContent=`${plan.objective} · Expected version ${plan.expectedVersion}`;
  const box=$('#plannerSteps');box.replaceChildren();
  if(!plan.steps.length) makeText(box,'div',plan.status==='already_satisfied'?'The contract already holds this exact allocation. No operations or transaction are necessary.':'No executable plan was found within the three-operation limit.','planner-empty');
  for(const [i,step] of plan.steps.entries()) {
    const row=document.createElement('div');row.className='planner-step';
    const no=document.createElement('b');no.textContent=String(i+1).padStart(2,'0');
    const content=document.createElement('div');
    makeText(content,'strong',describeAction(step));
    const mask=plan.preview?.stageMasks?.[i];
    const error=plan.preview?.operationError;
    let detail='Fe preview required';
    if(error && Math.floor(error/16)===i+1) detail=`Fe operation rejected: ${actionErrorLabels[error%16]||'Unknown error'}`;
    else if(mask!==undefined) detail=mask===0?'Fe operation valid · state within policy':`Fe operation valid · intermediate policy mask ${mask}`;
    makeText(content,'small',detail);
    row.append(no,content);box.append(row);
  }
  const reason=plan.reason;
  const mismatch=plan.goalMatches===false?' Goal matching failed.':'';
  const mask=plan.preview?.mask;
  const text=`${reason}${mismatch}${mask!==undefined&&mask!==0?` Fe policy mask ${mask}.`:''} ${plan.evaluated?`${plan.evaluated} Fe candidate preview(s).`:''}`;
  const desc=$('#plannerExplanation');desc.textContent=text;desc.className=`planner-explanation ${ready||plan.status==='already_satisfied'?'good':'bad'}`;
  $('#plannerCommitBtn').disabled=!ready || plannerBusy;
  plannerMessage(ready?'The contract will recheck all operations, current version, policy, and exact goal at commitment.':'Commit is unavailable until the selected goal and signer pass verification.',ready?'ok':'err');
}
async function plannerGenerate() {
  if(plannerBusy||!currentState) return;
  const sequence=++plannerSequence;
  generatedGoalPlan=null;$('#plannerCommitBtn').disabled=true;
  $('#plannerStatus').className='status loading';$('#plannerStatus').textContent='FE CHECKING';
  plannerMessage('Deriving candidate operations from the current Fe state…');
  try {
    const goal=plannerGoal();
    const data=await api('/api/planner/plan',{method:'POST',body:JSON.stringify({goal,expectedVersion:currentState.version,role:$('#plannerActor').value})});
    if(sequence!==plannerSequence) return;
    plannerShow(data.plan);
  }catch(error){
    if(sequence!==plannerSequence)return;
    $('#plannerStatus').className='status bad';$('#plannerStatus').textContent='PLAN FAILED';
    plannerMessage(error.message,'err');
  }
}
async function plannerCommit() {
  const plan=generatedGoalPlan;
  if(!plan||plan.status!=='ready'||plannerBusy) return;
  plannerBusy=true;$('#plannerCommitBtn').disabled=true;
  ++plannerSequence;
  plannerMessage('Executing Fe goal-attested transaction…');
  let notice;
  try {
    const data=await api('/api/planner/commit',{method:'POST',body:JSON.stringify({
      goal:plan.goal,expectedVersion:plan.expectedVersion,digest:plan.digest,role:plan.role,
    })});
    notice=data.result.success
      ?{text:`Fe attested the exact goal at v${data.state.version}. Tx ${brief(data.result.transactionHash)} · ${fmt(data.result.gasSpent)} gas.`,kind:'ok'}
      :{text:`Fe rejected the goal transaction; no state changed. Tx ${brief(data.result.transactionHash)}.`,kind:'err'};
    await loadHistory();
    plannerInvalidate();
    await load();
  }catch(error){
    notice={text:`Goal commit did not proceed: ${error.message}`,kind:'err'};
    plannerInvalidate();
  }finally{
    plannerBusy=false;
    $('#plannerCommitBtn').disabled=true;
    if(notice)plannerMessage(notice.text,notice.kind);
  }
}
function plannerPreset(name) {
  if(name==='move'){
    $('#plannerKind').value='shift';$('#plannerSource').value='0';$('#plannerDestination').value='1';$('#plannerQuantity').value='150';
  }else {
    $('#plannerKind').value='target';
    const target=name==='invalid'?['150','550','100']:['250','450','100'];
    ['A','B','C'].forEach((m,i)=>$(`#plannerTarget${m}`).value=target[i]);
  }
  plannerMode();plannerInvalidate();plannerGenerate();
}

// --- v1.6 market incident response: operator scenario + Fe plan comparison. ---
function incidentMessage(text,kind='') {
  $('#incidentMessage').textContent=text;
  $('#incidentMessage').className=`result-message ${kind}`;
}
function incidentInvalidate() {
  incidentSequence++;
  incidentAssessment=null;
  selectedIncidentStrategy=null;
  $('#incidentCommitBtn').disabled=true;
  $('#incidentStatus').className='status loading';
  $('#incidentStatus').textContent='REASSESS REQUIRED';
  $('#incidentSummary').textContent='The alert or contract state has changed. Compare fresh responses before commitment.';
  $('#incidentOptions').replaceChildren();
  makeText($('#incidentOptions'),'div','No current Fe-verified assessment.','planner-empty');
  $('#incidentDecision').className='incident-decision';
  $('#incidentDecision').textContent='Choose an operator-entered incident objective and request a fresh assessment.';
  incidentMessage('No transaction submitted.');
}
function incidentRequest() {
  if(!currentState) throw Error('Fe contract state not initialized');
  function getNum(id){
    const value=$(id).value.trim();
    if(!/^(0|[1-9][0-9]{0,19})$/.test(value)) throw Error(`${id.slice(1)} must be a nonnegative whole number (max 20 digits).`);
    return value;
  }
  return {incident:{market:$('#incidentMarket').value,maximum:getNum('#incidentMax'),reserve:getNum('#incidentReserve')},
    expectedVersion:currentState.version,role:$('#incidentActor').value};
}
function incidentSelect(id) {
  if(!incidentAssessment) return;
  const option=incidentAssessment.options.find(x=>x.id===id);
  if(!option||!['ready','unauthorized','requires_guardian'].includes(option.status)) return;
  selectedIncidentStrategy=id;
  for(const btn of $$('.incident-option')) {
    btn.classList.toggle('selected',btn.dataset.strategy===id);
    btn.setAttribute('aria-pressed',String(btn.dataset.strategy===id));
  }
  const metrics=option.metrics;
  $('#incidentDecision').className='incident-decision';
  $('#incidentDecision').textContent=`Selected: ${option.title}. Fe terminal target ${option.target.a} / ${option.target.b} / ${option.target.c}; ${metrics.allocated} units remain active and ${metrics.reserve} units stay unallocated. Ordered operations: ${option.steps.map(describeAction).join(' → ')}. Fe policy mask ${option.feMask}; Fe incident mask ${option.feIncidentMask}; exact goal ${option.feIncidentGoalMatches ? 'matched' : 'not matched'}.`;
  $('#incidentCommitBtn').disabled=option.status!=='ready'||incidentBusy;
  incidentMessage(option.status==='ready'?'Exact target and active guardian objective will be rechecked by Fe. No transaction has been sent.':option.status==='requires_guardian'?'Prospective Fe response only: guardian must first activate the persistent incident. No operator transaction is authorized yet.':'Fe confirms the plan but the selected signer is unauthorized; commitment disabled.',option.status==='ready'?'ok':'err');
}
function incidentShow(data) {
  incidentAssessment=data;
  selectedIncidentStrategy=null;
  const eligible=data.options.filter(o=>o.status==='ready');
  $('#incidentStatus').className=`status ${(eligible.length||data.status==='already_contained')?'good':data.options.some(o=>o.status==='unauthorized')?'loading':'bad'}`;
  $('#incidentStatus').textContent=({assessed:'FE OPTIONS VERIFIED',requires_guardian:'GUARDIAN ACTIVATION REQUIRED',infeasible:'NO VERIFIED RESPONSE',already_contained:'ALREADY CONTAINED',unreachable:'OUTSIDE SUPPORTED STRATEGIES'})[data.status]||data.status.toUpperCase();
  $('#incidentSummary').textContent=data.reason;
  const holder=$('#incidentOptions');holder.replaceChildren();
  if(!data.options.length) makeText(holder,'div',data.reason,'planner-empty');
  for(const option of data.options) {
    const available=['ready','unauthorized','requires_guardian'].includes(option.status);
    const button=document.createElement('button');button.type='button';button.className=`incident-option ${available?'':'warning'}`;
    button.dataset.strategy=option.id;button.setAttribute('aria-pressed','false');button.disabled=!available;
    const head=document.createElement('div');head.className='incident-option-head';
    makeText(head,'strong',option.title);
    makeText(head,'em',option.status==='ready'?'FE INCIDENT VERIFIED':option.status==='unauthorized'?'SIGNER BLOCKED':option.status==='requires_guardian'?'GUARDIAN FIRST':'NOT VERIFIED',option.status==='ready'?'':'blocked');
    button.append(head);
    makeText(button,'p',option.caption);
    if(available) {
      makeText(button,'div',`${option.target.a} / ${option.target.b} / ${option.target.c}`,'incident-option-target');
      const metrics=document.createElement('div');metrics.className='incident-option-metrics';
      makeText(metrics,'span',`${fmt(option.metrics.allocated)} active`);
      makeText(metrics,'span',`${fmt(option.metrics.reserve)} reserve`);
      makeText(metrics,'span',`${fmt(option.metrics.retired)} retired`);
      button.append(metrics);
      makeText(button,'div',`${option.steps.length} Fe operation(s) · ${option.steps.map(describeAction).join(' → ')} · Incident mask ${option.feIncidentMask} · Exact goal ${option.feIncidentGoalMatches?'PASS':'FAIL'}`,'incident-option-steps');
      button.addEventListener('click',()=>incidentSelect(option.id));
    } else {
      makeText(button,'p',option.reason);
    }
    holder.append(button);
  }
  $('#incidentCommitBtn').disabled=true;
  if(data.options.some(o=>o.status==='ready'))incidentSelect(data.options.find(o=>o.status==='ready').id);
  else if(data.options.some(o=>o.status==='requires_guardian'))incidentSelect(data.options.find(o=>o.status==='requires_guardian').id);
  else if(data.options.some(o=>o.status==='unauthorized'))incidentSelect(data.options.find(o=>o.status==='unauthorized').id);
  else {
    $('#incidentDecision').className='incident-decision invalid';
    $('#incidentDecision').textContent=data.reason||'The current Fe state has no verified response to this incident request.';
    incidentMessage(data.status==='already_contained'?'Incident already contained. No transaction is necessary.':'No transaction is available for this assessment.',data.status==='already_contained'?'ok':'err');
  }
}
async function incidentAssess() {
  if(incidentBusy||!currentState)return;
  const sequence=++incidentSequence;
  incidentAssessment=null;selectedIncidentStrategy=null;$('#incidentCommitBtn').disabled=true;
  $('#incidentStatus').className='status loading';$('#incidentStatus').textContent='FE CHECKING';
  incidentMessage('Comparing alternative operation plans against the current Fe contract…');
  try {
    const request=incidentRequest();
    const {assessment}=await api('/api/incident/assess',{method:'POST',body:JSON.stringify(request)});
    if(sequence!==incidentSequence)return;
    incidentShow(assessment);
  }catch(error){
    if(sequence!==incidentSequence)return;
    $('#incidentStatus').className='status bad';$('#incidentStatus').textContent='ASSESSMENT FAILED';
    $('#incidentDecision').className='incident-decision invalid';
    $('#incidentDecision').textContent=error.message;
    incidentMessage(error.message,'err');
  }
}
async function incidentCommit() {
  if(!incidentAssessment||!selectedIncidentStrategy||incidentBusy)return;
  const option=incidentAssessment.options.find(x=>x.id===selectedIncidentStrategy);
  if(!option||option.status!=='ready')return;
  incidentBusy=true;$('#incidentCommitBtn').disabled=true;++incidentSequence;
  incidentMessage('Reassessing the incident against the current Fe version and executing the selected exact target…');
  let notice;
  try {
    const data=await api('/api/incident/commit',{method:'POST',body:JSON.stringify({
      incident:incidentAssessment.incident,expectedVersion:incidentAssessment.expectedVersion,
      role:incidentAssessment.role,strategy:selectedIncidentStrategy,digest:option.digest,
    })});
    notice=data.result.success
      ?{text:`Fe committed the ${selectedIncidentStrategy} response at v${data.state.version}. Local tx ${brief(data.result.transactionHash)} · ${fmt(data.result.gasSpent)} gas.`,kind:'ok'}
      :{text:`Local Fe EVM rejected the response; no configuration changed. Tx ${brief(data.result.transactionHash)}.`,kind:'err'};
    incidentInvalidate();await load();await loadHistory();
  }catch(error){notice={text:`No incident transaction submitted or accepted: ${error.message}`,kind:'err'};incidentInvalidate();}
  finally {incidentBusy=false;if(notice)incidentMessage(notice.text,notice.kind);}
}
async function activateGuardianIncident() {
  if (incidentBusy || !currentState || !currentState.incident || Number(currentState.incident.phase)!==0) return;
  incidentBusy=true;$('#incidentGuardianActivateBtn').disabled=true;
  try {
    const p=incidentRequest();
    const response=await api('/api/guard/activate',{method:'POST',body:JSON.stringify({
      domain:'allocation',role:'guardian',mode:'progressive',expectedVersion:p.expectedVersion,
      market:p.incident.market,maximum:p.incident.maximum,bufferMinimum:p.incident.reserve,
    })});
    incidentInvalidate();await load();await loadHistory();
    incidentMessage(response.result.success
      ? `Guardian activated persistent Fe incident #${response.after.incident.id}. Reassess now; operator cannot bypass it.`
      : `Guardian activation REJECTED by Fe; state unchanged: ${response.result.error}` ,
      response.result.success?'ok':'err');
  } catch(e) {incidentMessage(`Guardian activation failed: ${e.message}`,'err');}
  finally {incidentBusy=false;$('#incidentGuardianActivateBtn').disabled=!!currentState.incident&&Number(currentState.incident.phase)!==0;}
}
function incidentPreset(name) {
  $('#incidentMarket').value='0';
  $('#incidentMax').value='200';
  $('#incidentReserve').value=name==='reserve'?'300':name==='impossible'?'950':'200';
  incidentInvalidate();incidentAssess();
}

function invalidatePreview() {
  ++previewSequence;
  lastPreview = null;
  $('#commitBtn').disabled = true;
  $('#proveBtn').disabled = true;
  $('#previewStatus').className = 'status loading';
  $('#previewStatus').textContent = 'DRAFT CHANGED';
  clearTimeout(debounceHandle);
  debounceHandle = setTimeout(refreshPreview, 170);
}
for (const input of $$('#inputGroup input')) input.addEventListener('input', invalidatePreview);
for (const button of $$('[data-page]')) button.addEventListener('click', () => switchPage(button.dataset.page));
for (const preset of $$('.preset')) preset.addEventListener('click', () => {
  const profiles = {
    balanced: { name:'balanced',a:350,b:350,c:150 },
    paired: { name:'paired',a:500,b:100,c:100 },
    over: { name:'over',a:500,b:450,c:300 },
  };
  updateInputs(profiles[preset.dataset.preset]);
});
$('#actorSelect').addEventListener('change', invalidatePreview);
$('#historyFilter').addEventListener('change', renderFullHistory);
$('#incidentGuardianActivateBtn').addEventListener('click',activateGuardianIncident);
$('#plannerKind').addEventListener('change',()=>{plannerMode();plannerInvalidate();});
for(const el of $$('#plannerView input, #plannerView select')) {
  if(el.id==='plannerKind')continue;
  el.addEventListener(el.tagName==='INPUT'?'input':'change',plannerInvalidate);
}
for(const preset of $$('.planner-preset'))preset.addEventListener('click',()=>plannerPreset(preset.dataset.plannerPreset));
$('#plannerGenerateBtn').addEventListener('click',plannerGenerate);
$('#plannerCommitBtn').addEventListener('click',plannerCommit);
for(const element of $$('#incidentView input, #incidentView select')) element.addEventListener(element.tagName==='INPUT'?'input':'change',incidentInvalidate);
for(const button of $$('.incident-preset')) button.addEventListener('click',()=>incidentPreset(button.dataset.incidentPreset));
$('#incidentAssessBtn').addEventListener('click',incidentAssess);
$('#incidentCommitBtn').addEventListener('click',incidentCommit);
plannerMode();
$('#reloadBtn').addEventListener('click', load);
$('#commitBtn').addEventListener('click', () => performCommit(false));
$('#proveBtn').addEventListener('click', () => performCommit(true));
load();

for (const select of $$('#migrationView select')) select.addEventListener('change', migrationInvalidate);
for (const input of $$('#migrationView input')) input.addEventListener('input', migrationInvalidate);
for (const preset of $$('.mig-preset')) preset.addEventListener('click', () => loadMigrationPreset(preset.dataset.migPreset));
$('#migrationCommitBtn').addEventListener('click', () => migrationCommit(false));
$('#migrationRejectBtn').addEventListener('click', () => migrationCommit(true));

// Action plan controls are UI serialization only; all outcomes come from Fe.
for (const select of $$('#operationsView select')) select.addEventListener('change',opsInvalidate);
for (const input of $$('#operationsView input')) input.addEventListener('input',opsInvalidate);
for (const preset of $$('.ops-preset')) preset.addEventListener('click',()=>setOpsPreset(preset.dataset.opsPreset));
$('#opsCommitBtn').addEventListener('click',()=>opsCommit(false));
$('#opsRejectBtn').addEventListener('click',()=>opsCommit(true));
for(let i=1;i<=3;i++) updateActionRow(i);
