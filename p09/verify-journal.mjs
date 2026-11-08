// Independent consistency check for all supported exported transaction variants.
// Local records and receipts are NOT authenticated chain attestations.
import{readFileSync}from'node:fs';import{createHash}from'node:crypto';
const data=JSON.parse(readFileSync(process.argv[2],'utf8')),entries=data.journalEntries;
const must=(ok,why)=>{if(!ok)throw Error('P09_AUDIT_INVALID '+why)};
const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
let previous='0'.repeat(64),transactions=0;
for(const [i,entry]of entries.entries()){
 const{digest,...body}=entry;must(body.index===i+1&&body.previousDigest===previous,'link');must(createHash('sha256').update(JSON.stringify(body)).digest('hex')===digest,'digest');previous=digest;
 const e=body.event;if(e.kind!=='transaction')continue;transactions++;
 must(/^0x[0-9a-f]{64}$/i.test(e.txHash),'tx identity');must(BigInt(e.gasSpent)>0n,'gas');
 const mirror=data.transactions.find(v=>v.index===entry.index&&v.txHash===e.txHash);must(mirror?.digest===digest,'export mirror');must(canonical(mirror.after)===canonical(e.after),'mirror state');
 if(e.outcome==='committed'){
  must(BigInt(e.after.version)===BigInt(e.before.version)+1n,'revision');
  if(e.target)for(const k of ['a','b','c'])must(e.target[k]===e.after[k],'target');
  for(const k of ['policyMask','operationError'])if(e[k]!==undefined)must(e[k]===0,k);
  if(e.authorized!==undefined)must(e.authorized===true,'authorization');
  must(e.evmException===null&&e.rejectionCategory===null,'successful receipt');
 }else{
  must(e.outcome==='rejected','outcome');must(canonical(e.protectedBefore??e.before)===canonical(e.protectedAfter??e.after),'rollback');
 }
 if(e.receipt){must(e.receipt.success===(e.outcome==='committed'),'receipt outcome');must(e.receipt.transactionHash===e.txHash,'receipt identity')}
}
must(data.audit.lastDigest===previous&&data.audit.entries===entries.length,'reported head');must(data.transactions.length===transactions,'count');
console.log('P09_SUPPORTED_EXPORT_VARIANTS=PASS transactions='+transactions);
