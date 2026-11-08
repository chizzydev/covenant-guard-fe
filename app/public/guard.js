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
// Evidence is a presentation of the returned data, never a policy oracle.
let evidencePayload=null;
function node(tag,text,className='') {
  const el=document.createElement(tag);el.textContent=String(text);if(className)el.className=className;return el;
}
function jsonView(el,value) {
  const json=JSON.stringify(value,null,2),fragment=document.createDocumentFragment();
  const tokens=/"(?:\\.|[^"\\])*"\s*:|"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  let cursor=0;
  for(const match of json.matchAll(tokens)) {
    fragment.append(document.createTextNode(json.slice(cursor,match.index)));
    const token=match[0],kind=token.startsWith('"')?(token.trimEnd().endsWith(':')?'key':'string'):/^(true|false|null)$/.test(token)?'literal':'number';
    fragment.append(node('span',token,'json-'+kind));cursor=match.index+token.length;
  }
  fragment.append(document.createTextNode(json.slice(cursor)));el.replaceChildren(fragment);
}
function evidenceTab(name,focus=false) {
  for(const button of document.querySelectorAll('[data-evidence-tab]')) {
    const selected=button.dataset.evidenceTab===name;
    button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;
    $('evidence-'+button.dataset.evidenceTab).hidden=!selected;
    if(selected&&focus)button.focus();
  }
}
function dump(payload) {
  evidencePayload=payload;jsonView($('output'),payload);
  const tx=payload.result,p=payload.preview,current=payload.after||payload.current||payload.states?.[domain];
  const degraded=Boolean(payload.audit?.mutationsBlocked)||Boolean(payload.recoveryRequired);
  const kind=tx?(degraded?'degraded':tx.success?'committed':'rejected'):payload.error?'error':p?'preview':'state';
  $('evidence').dataset.kind=kind;
  $('evidenceBadge').textContent={committed:'TRANSACTION · COMMITTED',rejected:'TRANSACTION · REJECTED',degraded:'AUDIT DEGRADED',error:'REQUEST ERROR',preview:'READ-ONLY PREVIEW',state:'READ-ONLY STATE'}[kind];
  $('evidenceTitle').textContent=tx?(degraded?'Outcome recorded · audit unresolved':tx.success?'State change committed':'Rejected by the EVM'):payload.error?'Request did not complete':p?(p.eligible?'Preview eligible':'Preview not eligible'):'Deployed state inspected';
  $('evidenceSubtitle').textContent=tx?(degraded?'Do not retry. Preserve the receipt and reconcile the local journal.':tx.success?'The returned receipt and resulting state are available below.':'The returned receipt reports a rejection. Compare the protected snapshots below.'):
    payload.error?'No EVM outcome is inferred from this request error. Check current state before retrying.':p?'Static Fe evaluation only. No transaction was submitted.':`${domain==='allocation'?'Allocation':'Governance'} · ${payload.cached?'last-read snapshot':'Fe EVM static calls'}. No transaction submitted.`;
  $('evidenceRevision').textContent=payload.before&&payload.after?`${payload.before.version} → ${payload.after.version}`:current?.version??'—';
  $('evidenceGas').textContent=tx?.gasSpent??'Not submitted';
  $('evidenceAudit').textContent=degraded?'Unresolved':payload.journal?.index!=null?`Entry #${payload.journal.index}`:payload.audit?.health??'Not applicable';
  const fields=tx?[
    ['Action',tx.method],['Caller role',tx.role],['Transaction hash',tx.transactionHash],['Sender',tx.sender],
    ['EVM result',tx.success?'Success':tx.error||'Rejected'],['Journal digest',payload.journal?.digest??'Not persisted'],
  ]:p?[
    ['Policy mask',p.mask],['Policy evaluation',p.allowed?'Accepted':'Rejected'],['Caller authorized',String(p.authorized)],
    ['Eligible to commit',String(p.eligible)],['Next revision (preview)',p.nextVersion],['Source','Fe EVM static call · no transaction'],
  ]:payload.error?[
    ['Request error',payload.error],['Context',payload.context||domain],['Transaction outcome','Not inferred'],
  ]:[
    ['Domain',domain],['Deployed contract',current?.contract??'Unavailable'],['Operator',current?.operator??'Unavailable'],
    ['Guardian',current?.guardian??'Unavailable'],['Source',payload.cached?'Last-read Fe snapshot':'Fe EVM static calls'],['Incident phase',phases[current?.incident?.phase]??'Unknown'],
  ];
  $('evidenceFields').replaceChildren(...fields.map(([key,value])=>{
    const row=document.createElement('div');row.append(node('dt',key),node('dd',value??'Not returned'));return row;
  }));
  const before=payload.before,after=payload.after;
  if(before&&after) {
    const table=document.createElement('table');table.className='comparison-table';
    const caption=node('caption','Protected state comparison');caption.className='sr-only';table.append(caption);
    const head=document.createElement('thead'),headRow=document.createElement('tr');
    for(const text of ['Protected field','Before','After']){const th=node('th',text);th.scope='col';headRow.append(th)}head.append(headRow);table.append(head);
    const body=document.createElement('tbody');
    const values=s=>[s.version,s.x,s.y,s.z,phases[s.incident.phase]??s.incident.phase,s.incident.id,s.incident.market,s.incident.maximum,s.incident.bufferMinimum,s.deficits.exposure,s.deficits.buffer];
    const a=values(before),b=values(after);
    for(const [i,label]of ['Revision',...names[domain],'Incident phase','Incident ID','Protected field index','Exposure ceiling','Buffer minimum','Exposure deficit','Buffer deficit'].entries()) {
      const row=document.createElement('tr');row.append(node('td',label),node('td',a[i]),node('td',b[i],a[i]!==b[i]?'changed':''));body.append(row);
    }
    table.append(body);$('stateComparison').replaceChildren(table);
  } else $('stateComparison').replaceChildren(node('p','Before / after comparison is available for submitted transactions. The complete current state or preview remains in Raw response.','empty-evidence'));
  if(tx)jsonView($('receiptOutput'),{receipt:tx,journal:payload.journal,audit:payload.audit});
  else $('receiptOutput').textContent='No transaction receipt. State reads and previews do not submit a transaction. The complete response remains available in Raw response.';
  $('copyStatus').textContent='Full response retained in Raw response.';
}
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
  if (!res.ok) throw Object.assign(Error(`${res.status}: ${json.error || 'Request rejected'}`),{response:json});
  return json;
}
function info() {
  if (!states || !states[domain]) throw Error('Contract state unavailable');
  return states[domain];
}
function setBusy(value) {
  busy=value;
  for (const id of ['refresh','preview','commit','migrate','progressive','atomic','release']) {
    $(id).disabled=value||$(id).dataset.auditBlocked==='true';
  }
  $('workspace').setAttribute('aria-busy',String(value));
  for(const b of document.querySelectorAll('[data-domain]'))b.disabled=value;
}
function render(loadInputs=true) {
  const s=info();
  const labels=names[domain];
  $('description').textContent=domain==='allocation'?
    'Changes must satisfy permanent allocation policy and any active incident.':
    'Quorum, membership and delay remain subject to permanent policy and any active incident.';
  $('address').textContent=s.contract;
  $('revision').textContent=s.version;
  $('phase').textContent=phases[s.incident.phase]||'UNKNOWN';
  $('exposure').textContent=s.deficits.exposure;
  $('buffer').textContent=s.deficits.buffer;
  $('domainTitle').textContent=domain==='allocation'?'Allocation protection':'Governance controls';
  $('healthCard').dataset.phase=String(s.incident.phase);
  $('healthDescription').textContent=[
    'Permanent policy is enforced. No active emergency obligation.',
    'An obligation is active. Recover without increasing either deficit.',
    'Both deficits are zero. Maintain containment until guardian release.',
  ][s.incident.phase]||'Unknown phase returned by the contract.';
  for(const el of document.querySelectorAll('[data-phase]'))el.classList.toggle('current',el.dataset.phase===String(s.incident.phase));
  for(const [i,key]of ['X','Y','Z'].entries()){$('currentLabel'+key).textContent=labels[i];$('current'+key).textContent=s[['x','y','z'][i]]}
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
    dump({...data,source:'Fe EVM static calls'});
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
  } catch(e) {show(resultEl,e.message,'fail');dump({...e.response,error:e.message,context:`${domain} · ${path}`});}
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
  } catch(e) {show('previewResult',e.message,'fail');dump({...e.response,error:e.message,context:`${domain} · preview`});}
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
  dump({source:'Last-read Fe EVM state',cached:true,states});
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
const roleHints={admin:'Operator changes protected state. Incident activation and release require the guardian.',guardian:'Guardian activates and releases incidents. Protected state changes require the operator.',reviewer:'Reviewer has no write authority. Fe rejects unauthorized transaction attempts.'};
function roleHint(){ $('roleHint').textContent=roleHints[$('role').value]+' Demo signers; role selection is not authentication.'; }
$('role').addEventListener('change',roleHint);
roleHint();
const evidenceTabs=[...document.querySelectorAll('[data-evidence-tab]')];
for(const [index,button]of evidenceTabs.entries()) {
  button.addEventListener('click',()=>evidenceTab(button.dataset.evidenceTab));
  button.addEventListener('keydown',event=>{
    let next;if(event.key==='ArrowRight')next=(index+1)%evidenceTabs.length;
    else if(event.key==='ArrowLeft')next=(index+evidenceTabs.length-1)%evidenceTabs.length;
    else if(event.key==='Home')next=0;else if(event.key==='End')next=evidenceTabs.length-1;else return;
    event.preventDefault();evidenceTab(evidenceTabs[next].dataset.evidenceTab,true);
  });
}
$('copyEvidence').addEventListener('click',async()=>{
  if(!evidencePayload)return;
  try {await navigator.clipboard.writeText(JSON.stringify(evidencePayload,null,2));$('copyStatus').textContent='Complete response copied.';}
  catch{$('copyStatus').textContent='Clipboard unavailable. Select and copy the Raw response.';evidenceTab('raw');$('output').focus();}
});
load(true).catch(e=>{show('previewResult',`Initialization failed: ${e.message}`,'fail');dump({...e.response,error:e.message});});
