// Local integrity evidence only. The local host can rewrite journal + sidecar.
// Write-ahead intent precedes execution; a known outcome precedes journal append.
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,appendFileSync,renameSync,unlinkSync} from 'node:fs';
import {dirname} from 'node:path';
const GENESIS='0'.repeat(64);
const hash=x=>createHash('sha256').update(x).digest('hex');
function parse(content) {
  if(content && !content.endsWith('\n')) throw Error('AUDIT_JOURNAL_INCOMPLETE_LAST_LINE');
  const entries=[];
  for(const [i,line] of content.split('\n').filter(Boolean).entries()) {
    let entry;try{entry=JSON.parse(line)}catch{throw Error('AUDIT_JOURNAL_BAD_JSON_LINE='+String(i+1))}
    const {digest,...body}=entry;
    if(body.index!==i+1||body.previousDigest!==(entries.at(-1)?.digest||GENESIS)||
      !/^[a-f0-9]{64}$/.test(String(digest))||hash(JSON.stringify(body))!==digest)
      throw Error('AUDIT_JOURNAL_INTEGRITY_FAILURE_LINE='+String(i+1));
    entries.push(entry);
  }
  return entries;
}
export function createAuditJournal(filepath,{sessionId=randomUUID()}={}) {
  mkdirSync(dirname(filepath),{recursive:true});
  const pendingPath=filepath+'.pending.json';
  let pending=existsSync(pendingPath)?JSON.parse(readFileSync(pendingPath,'utf8')):null;
  let degraded=Boolean(pending),active=false,deferredSession=Boolean(pending),lastError=null;
  function disk(){return existsSync(filepath)?readFileSync(filepath):Buffer.alloc(0)}
  function checkedBase(p) {
    if(p.schema!=='COVENANT_AUDIT_INTENT_V1'||typeof p.id!=='string'||
       !Number.isSafeInteger(p.priorSize)||p.priorSize<0||! /^[a-f0-9]{64}$/.test(p.priorHash))
      throw Error('AUDIT_RECOVERY_INVALID_INTENT');
    const raw=disk(),base=raw.subarray(0,p.priorSize);
    if(base.length!==p.priorSize||hash(base)!==p.priorHash) throw Error('AUDIT_RECOVERY_BASE_CHANGED');
    parse(base.toString('utf8'));return {raw,base,tail:raw.subarray(p.priorSize)};
  }
  let entries=pending?parse(checkedBase(pending).base.toString('utf8')):parse(disk().toString('utf8'));
  function persist(p) {
    const tmp=pendingPath+'.tmp';
    writeFileSync(tmp,JSON.stringify(p,null,2),{encoding:'utf8',flush:true});
    renameSync(tmp,pendingPath);
  }
  function bodyFor(event){const body={index:entries.length+1,previousDigest:entries.at(-1)?.digest||GENESIS,
    timestamp:new Date().toISOString(),sessionId,event};return {...body,digest:hash(JSON.stringify(body))}}
  function rawAppend(entry) {
    appendFileSync(filepath,JSON.stringify(entry)+'\n',{encoding:'utf8',flush:true});entries.push(entry);return entry;
  }
  function clearPending(){if(existsSync(pendingPath))unlinkSync(pendingPath);pending=null;degraded=false;lastError=null}
  function append(event) {
    const entry=bodyFor(event);
    if(event.kind!=='transaction'||!active) return rawAppend(entry);
    pending={...pending,phase:'outcome',entry};
    try {
      persist(pending);
      rawAppend(entry);
      clearPending();
      return entry;
    } catch(error) {
      degraded=true;lastError=String(error.code||error.message);
      // The response retains the REAL receipt from the completed operation.
      // It must not suggest an EVM revert or encourage a repeat transaction.
      return {...entry,index:null,digest:null,auditDegraded:true};
    }
  }
  function assertWritable(){if(degraded||pending)throw Object.assign(Error('AUDIT_UNRESOLVED_MUTATIONS_BLOCKED'),{code:'AUDIT_UNRESOLVED'})}
  async function runMutation(work) {
    assertWritable();
    const raw=disk();parse(raw.toString('utf8'));
    const intent={schema:'COVENANT_AUDIT_INTENT_V1',id:randomUUID(),sessionId,
      phase:'intent',priorSize:raw.length,priorHash:hash(raw),createdAt:new Date().toISOString()};
    // If this fails no transaction is allowed to start.
    persist(intent);pending=intent;active=true;
    try {
      const result=await work();
      if(pending?.phase==='intent')clearPending(); // completed preflight-only response
      return result;
    } catch(error) {
      // A throw after submission may have an unknown outcome: retain the intent.
      degraded=true;lastError=String(error.code||error.message);throw error;
    } finally {active=false}
  }
  function reconcile({acknowledgeUnknownSession=null}={}) {
    if(!pending)return {reconciled:false,status:'healthy'};
    const p=pending,{base,tail}=checkedBase(p);
    if(p.phase==='outcome') {
      const entry=p.entry;
      if(!entry||entry.event?.kind!=='transaction'||entry.sessionId!==p.sessionId)
        throw Error('AUDIT_RECOVERY_INVALID_OUTCOME');
      const complete=Buffer.from(JSON.stringify(entry)+'\n');
      parse(base.toString('utf8')+complete.toString('utf8'));
      if(tail.length>complete.length||!tail.equals(complete.subarray(0,tail.length)))
        throw Error('AUDIT_RECOVERY_UNEXPECTED_TAIL');
      // Repair only an exact prefix of the pending record, never arbitrary data.
      writeFileSync(filepath,Buffer.concat([base,complete]),{flush:true});
      entries=parse(Buffer.concat([base,complete]).toString('utf8'));
    } else {
      if(p.phase!=='intent'||acknowledgeUnknownSession!==p.sessionId||!deferredSession)
        throw Error('AUDIT_RECOVERY_UNKNOWN_OUTCOME_REQUIRES_RESTART_AND_EXPLICIT_ACK');
      if(tail.length)throw Error('AUDIT_RECOVERY_UNEXPECTED_TAIL');
      entries=parse(base.toString('utf8'));
      rawAppend(bodyFor({kind:'recovery_unknown',requestId:p.id,previousSession:p.sessionId,
        outcome:'unknown',note:'Previous disposable EVM reset; no successful transaction inferred.'}));
    }
    const recoveredId=p.id;clearPending();
    if(deferredSession){deferredSession=false;rawAppend(bodyFor({kind:'session',label:'local EVM restarted; prior journal recovery completed'}))}
    return {reconciled:true,requestId:recoveredId,status:'healthy',previousOutcome:p.phase==='outcome'?'recorded':'unknown'};
  }
  function status(){return {sessionId,verifiedAtStartup:true,lastDigest:entries.at(-1)?.digest||GENESIS,
    entries:entries.length,health:degraded||(!active&&pending)?'degraded':'healthy',mutationsBlocked:degraded||(!active&&Boolean(pending)),
    recoveryRequired:degraded||(!active&&Boolean(pending)),pendingId:pending?.id||null,
    pendingSession:pending?.sessionId||null,outcomeKnown:pending?.phase==='outcome',lastError,
    journal:'local hash-linked JSONL with local recovery sidecar; not blockchain-authenticated or tamper-proof'}}
  function list({session='all',limit=300}={}){return entries.filter(e=>session!=='current'||e.sessionId===sessionId)
    .filter(e=>e.event.kind==='transaction').slice(-limit).reverse().map(e=>({...e.event,time:e.timestamp,index:e.index,sessionId:e.sessionId,digest:e.digest}))}
  if(!pending)rawAppend(bodyFor({kind:'session',label:'local EVM started; in-memory contract state reset'}));
  return {append,list,exportRecords:()=>entries.map(e=>({...e})),status,sessionId,path:filepath,
    pendingPath,assertWritable,runMutation,reconcile};
}
