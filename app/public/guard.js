// P06 browser: presentation only. Fe bytecode makes every policy decision.
const $ = id => document.getElementById(id);
let domain = 'allocation';
let states = null;
let busy = false;
const phases = ['INACTIVE', 'RECOVERING', 'CONTAINED'];
const names = {
  allocation:['Core market','Supporting','Satellite'],
  governance:['Quorum','Membership','Min delay'],
};
function show(id,message,kind='') {
  const el=$(id);el.textContent=message;el.className=`outcome ${kind}`;
}
function dump(payload) { $('output').textContent=JSON.stringify(payload,null,2); }
function read(id) {
  const raw=$(id).value.trim();
  if (!/^(0|[1-9][0-9]{0,19})$/.test(raw)) throw Error(`${id}: enter a nonnegative whole number`);
  return raw;
}
async function api(path,body) {
  const res=await fetch('/api/guard/'+path,body===undefined?undefined:{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),
  });
  const json=await res.json();
  if (!res.ok) throw Error(`${res.status}: ${json.error || 'Request rejected'}`);
  return json;
}
function info() {
  if (!states || !states[domain]) throw Error('Contract state unavailable');
  return states[domain];
}
function setBusy(value) {
  busy=value;
  for (const id of ['refresh','preview','commit','migrate','progressive','atomic','release']) {
    $(id).disabled=value;
  }
}
function render(loadInputs=true) {
  const s=info();
  const labels=names[domain];
  $('description').textContent=s.ruleDescription;
  $('address').textContent=s.contract;
  $('revision').textContent=s.version;
  $('phase').textContent=phases[s.incident.phase]||'UNKNOWN';
  $('exposure').textContent=s.deficits.exposure;
  $('buffer').textContent=s.deficits.buffer;
  $('incidentId').textContent=s.incident.id;
  $('protectedMarket').textContent=labels[Number(s.incident.market)]||'—';
  $('incidentMaximum').textContent=s.incident.maximum;
  $('incidentMinimum').textContent=s.incident.bufferMinimum;
  $('labelX').textContent=labels[0];$('labelY').textContent=labels[1];$('labelZ').textContent=labels[2];
  $('riskExposure').style.width=`${Math.min(100,Number(s.deficits.exposure)/200*100)}%`;
  $('riskBuffer').style.width=`${Math.min(100,Number(s.deficits.buffer)/200*100)}%`;
  $('market').disabled=domain==='governance';
  if (domain==='governance') $('market').value='0';
  if (loadInputs) {
    $('x').value=s.x;$('y').value=s.y;$('z').value=s.z;
    $('first').value=domain==='governance'?'1':'0';
    $('second').value=domain==='governance'?'0':'1';
    $('firstValue').value=domain==='governance'?s.y:s.x;
    $('secondValue').value=domain==='governance'?s.x:s.y;
    $('maximum').value=domain==='governance'?'2':'200';
    $('bufferMinimum').value=domain==='governance'?'7':'300';
  }
  for (const b of document.querySelectorAll('[data-domain]')) {
    const selected=b.dataset.domain===domain;
    b.classList.toggle('active',selected);
    b.setAttribute('aria-pressed',String(selected));
  }
}
async function load(loadInputs=true) {
  setBusy(true);
  try {
    const data=await api('state');
    states=data.states;
    render(loadInputs);
    if (loadInputs) show('previewResult','Fe contract state loaded. You can now preview a change.');
    dump({source:'Fe EVM static calls',states:data.states, addresses:data.runtime.contracts});
  } finally {setBusy(false);}
}
async function operation(path,payload,resultEl='incidentResult') {
  if (busy) return;
  setBusy(true);
  try {
    const response=await api(path,payload);
    dump(response);
    show(resultEl, response.outcome==='committed_audit_degraded' ?
      `COMMITTED, AUDIT DEGRADED - do not retry; revision ${response.after.version}` : response.result.success ?
      `COMMITTED · ${response.result.method} · gas ${response.result.gasSpent} · revision ${response.after.version}`:
      `REJECTED BY EVM · ${response.result.method} · state unchanged · ${response.result.error}`,
      response.result.success?'ok':'fail');
    const current=await api('state');
    states=current.states;
    render(true);
  } catch(e) {show(resultEl,e.message,'fail');}
  finally {setBusy(false);}
}
function base() {return {domain,role:$('role').value,expectedVersion:info().version};}
function draft() {return {x:read('x'),y:read('y'),z:read('z')};}
async function preview() {
  if (busy) return;
  setBusy(true);
  try {
    const data=await api('preview',{...base(),...draft()});
    dump(data);
    show('previewResult',`Fe mask ${data.preview.mask} · ${data.preview.allowed?'policy accepted':'policy rejected'} · ${data.preview.authorized?'operator selected':'role cannot commit'} · next revision ${data.preview.nextVersion}`,
      data.preview.eligible?'ok':'fail');
  } catch(e) {show('previewResult',e.message,'fail');}
  finally {setBusy(false);}
}
function invoke(fn,resultEl) {
  return async()=>{
    try {const [path,payload]=fn();await operation(path,payload,resultEl);}
    catch(e) {show(resultEl,e.message,'fail');}
  };
}
$('refresh').addEventListener('click',()=>load(true).catch(e=>show('previewResult',e.message,'fail')));
for (const b of document.querySelectorAll('[data-domain]')) b.addEventListener('click',()=>{
  if (busy) return;
  domain=b.dataset.domain;
  render(true);
  show('previewResult','Domain switched. All displayed values come from deployed Fe EVM state.');
  show('incidentResult','No incident command submitted.');
});
$('preview').addEventListener('click',preview);
$('commit').addEventListener('click',invoke(()=>['commit',{...base(),...draft()}],'previewResult'));
$('migrate').addEventListener('click',invoke(()=>['migrate',{
  ...base(),first:read('first'),firstValue:read('firstValue'),
  second:read('second'),secondValue:read('secondValue'),
}],'previewResult'));
$('progressive').addEventListener('click',invoke(()=>['activate',{
  ...base(),mode:'progressive',market:read('market'),maximum:read('maximum'),
  bufferMinimum:read('bufferMinimum'),
}],'incidentResult'));
$('atomic').addEventListener('click',invoke(()=>['activate',{
  ...base(),mode:'atomic',market:read('market'),maximum:read('maximum'),
  bufferMinimum:read('bufferMinimum'),...draft(),
}],'incidentResult'));
$('release').addEventListener('click',invoke(()=>['release',{
  ...base(),incidentId:info().incident.id,
}],'incidentResult'));
load(true).catch(e=>{show('previewResult',`Initialization failed: ${e.message}`,'fail');dump({error:e.message});});
