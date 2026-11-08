// Both browser surfaces expose persistence degradation independently of EVM outcome.
const banner=document.createElement('aside');banner.id='auditRecoveryBanner';
banner.setAttribute('role','status');banner.style.cssText='position:sticky;top:0;z-index:999;padding:12px;background:#573818;color:white;display:none';
const message=document.createElement('span'),recover=document.createElement('button');
recover.textContent='Reconcile recorded outcome';recover.type='button';
banner.append(message,document.createTextNode(' '),recover);document.body.prepend(banner);
let blocked=false;
function render(audit) {
  blocked=Boolean(audit?.mutationsBlocked);banner.style.display=blocked?'block':'none';
  message.textContent=blocked?'AUDIT DEGRADED: a transaction may already be committed. Do not retry. Further mutations are blocked. '+
    (audit.outcomeKnown?'Its recorded receipt can be reconciled.':'Outcome is unresolved; restart and follow the explicit recovery procedure.') : '';
  recover.disabled=!audit?.outcomeKnown;
  for(const button of document.querySelectorAll('button')) {
    if(button===recover)continue;
    if(blocked&&/commit|execute|activate|release|recover|migrat|progressive|atomic|incidentGuardianActivateBtn/i.test(button.id)) {
      button.dataset.auditBlocked='true';button.disabled=true;
    } else if(!blocked&&button.dataset.auditBlocked){delete button.dataset.auditBlocked;button.disabled=false}
  }
}
const originalFetch=window.fetch.bind(window);
window.fetch=async(...args)=>{
  const response=await originalFetch(...args);
  try {const data=await response.clone().json();if(data.audit)render(data.audit)}catch{}
  return response;
};
recover.addEventListener('click',async()=>{
  recover.disabled=true;
  try {const r=await fetch('/api/audit/reconcile',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    const data=await r.json();if(!r.ok)throw Error(data.error);render(data.audit);
  } catch(error){message.textContent='Recovery refused: '+error.message;recover.disabled=false}
});
setInterval(()=>fetch('/api/audit/status').catch(()=>{}),2000);
fetch('/api/audit/status').catch(()=>{});
