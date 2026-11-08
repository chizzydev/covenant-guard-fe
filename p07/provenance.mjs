// Baseline artifact provenance + exact ABI selector inventory.
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {Interface} from 'ethers';
const root=resolve(import.meta.dirname,'..');
const prefix=resolve(root,'artifacts','guard','flagship','AllocationFlagship');
const abi=JSON.parse(readFileSync(prefix+'.abi.json','utf8'));
const bytecode=readFileSync(prefix+'.bin','utf8').trim();
const actual=abi.filter(f=>f.type==='function').map(f=>f.name).sort();
const readMethods=['snapshot','operator','guardian','policyConstants','canCommit','incidentSnapshot',
    'incidentDeficits','preview','previewMigration','previewActions','previewIncidentActions'];
const writers=['commit','commitMigration','commitActions','commitGoalActions',
    'commitIncidentActions','activateProgressive','activateContain','releaseIncidentBound'];
const expected=[...readMethods,...writers].sort();
if(JSON.stringify(actual)!==JSON.stringify(expected)){
  throw Error('P07_ABI_UNRECOGNIZED_SELECTOR: '+JSON.stringify({actual,expected}));
}
const iface=new Interface(abi);
const selectorInventory=Object.fromEntries(expected.map(name=>[name,iface.getFunction(name).selector]));
if(Object.values(selectorInventory).length!==new Set(Object.values(selectorInventory)).size)
  throw Error('P07_ABI_SELECTOR_COLLISION');
const sha=b=>createHash('sha256').update(b).digest('hex');
const summary={baseline:'P06_R4_OWNER_VERIFIED_2026-11-08',abiSha256:sha(readFileSync(prefix+'.abi.json')),
    bytecodeSha256:sha(readFileSync(prefix+'.bin')),bytecodeBytes:bytecode.replace(/^0x/,'').length/2,
    compiler:'fe 26.5.0 (3dab95f), owner-pinned binary',
    selectors:selectorInventory,writerMethods:writers,readMethods,
    guarantees:'Source/ABI provenance only. Does not prove contract semantic security.'};
const dest=resolve(root,'results','p07');mkdirSync(dest,{recursive:true});
writeFileSync(resolve(dest,'artifact-provenance.json'),JSON.stringify(summary,null,2));
console.log('P07_EXACT_19_SELECTOR_ABI_INVENTORY=PASS');
console.log('P07_ALL_EIGHT_WRITERS_ENUMERATED=PASS');
console.log('P07_FLAGSHIP_BIN_SHA256='+summary.bytecodeSha256);
