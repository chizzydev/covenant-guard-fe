// P07 independent signed-EVM TRANSPORT. No application HTTP/planner adapters.
// Acceptance expectations are sourced solely from the Python state oracle.
// Mutants may supply a separate compiled artifact prefix; none uses real funds.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Common, Hardfork, Mainnet } from '@ethereumjs/common';
import { createLegacyTx } from '@ethereumjs/tx';
import { createAccount, createAddressFromPrivateKey, hexToBytes, bytesToHex } from '@ethereumjs/util';
import { createVM, runTx } from '@ethereumjs/vm';
import { AbiCoder, Interface } from 'ethers';

const root=resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function createEvmSession(artifactPrefix = null) {
  const keys={
    admin:hexToBytes(`0x${'11'.repeat(32)}`),
    reviewer:hexToBytes(`0x${'22'.repeat(32)}`),
    guardian:hexToBytes(`0x${'33'.repeat(32)}`),
  };
  const callers=Object.fromEntries(Object.entries(keys).map(([k,v])=>[k,createAddressFromPrivateKey(v)]));
  const common=new Common({chain:Mainnet,hardfork:Hardfork.Osaka});
  const vm=await createVM({common});
  for (const address of Object.values(callers)) {
    await vm.stateManager.putAccount(address,createAccount({nonce:0n,balance:10n**24n}));
  }
  const artifact=artifactPrefix || resolve(root,'artifacts','guard','flagship','AllocationFlagship');
  const abi=JSON.parse(readFileSync(`${artifact}.abi.json`,'utf8'));
  const iface=new Interface(abi);
  const required=['snapshot','operator','guardian','policyConstants','canCommit',
    'incidentSnapshot','incidentDeficits','preview','commit','previewMigration',
    'commitMigration','previewActions','commitActions','commitGoalActions',
    'previewIncidentActions','commitIncidentActions','activateProgressive',
    'activateContain','releaseIncidentBound'];
  for (const name of required) if (!iface.hasFunction(name)) throw Error(`FLAGSHIP_ABI_MISSING=${name}`);
  if (iface.hasFunction('earlyInvalid') || iface.hasFunction('releaseIncident')) {
    throw Error('FLAGSHIP_UNSAFE_LEGACY_SELECTOR_EXPOSED');
  }
  if (iface.deploy.inputs.length!==1 || iface.deploy.inputs[0].type!=='address') {
    throw Error('FLAGSHIP_GUARDIAN_CONSTRUCTOR_MISMATCH');
  }
  const raw=readFileSync(`${artifact}.bin`,'utf8').trim();
  if (!/^(?:0x)?(?:[0-9a-f]{2})+$/i.test(raw)) throw Error('FLAGSHIP_BAD_BYTECODE');
  const bytecode=raw.startsWith('0x')?raw:`0x${raw}`;
  async function sendEncoded(data,role='admin',to=undefined){
    if(!Object.hasOwn(callers,role))throw Error('FLAGSHIP_UNKNOWN_SIGNER');
    const from=callers[role];
    const account=await vm.stateManager.getAccount(from);
    const tx=createLegacyTx({nonce:account.nonce,gasLimit:8_000_000n,
      gasPrice:100_000_000_000n,value:0n,data,...(to?{to}:{})}, {common}).sign(keys[role]);
    const result=await runTx(vm,{tx});
    return {success:!result.execResult.exceptionError,
      error:result.execResult.exceptionError?String(result.execResult.exceptionError):null,
      createdAddress:result.createdAddress,gasSpent:String(result.totalGasSpent),transactionHash:bytesToHex(tx.hash()),sender:from.toString(),nonce:String(tx.nonce)};
  }
  const ctor=AbiCoder.defaultAbiCoder().encode(['address'],[callers.guardian.toString()]);
  const deploy=await sendEncoded(`${bytecode}${ctor.slice(2)}`);
  if(!deploy.success||!deploy.createdAddress)throw Error(`FLAGSHIP_DEPLOY_FAILED=${deploy.error}`);
  const address=deploy.createdAddress;
  async function view(name,args=[],role='reviewer'){
    if(!Object.hasOwn(callers,role))throw Error('FLAGSHIP_UNKNOWN_SIGNER');
    const caller=callers[role];
    const r=await vm.evm.runCall({to:address,caller,origin:caller,isStatic:true,
      gasLimit:8_000_000n,data:hexToBytes(iface.encodeFunctionData(name,args))});
    if(r.execResult.exceptionError)throw Error(`FLAGSHIP_VIEW_FAILED:${name}:${r.execResult.exceptionError}`);
    return iface.decodeFunctionResult(name,r.execResult.returnValue);
  }
  async function transact(name,args=[],role='admin'){
    return sendEncoded(iface.encodeFunctionData(name,args),role,address);
  }
  async function state(){
    const [s,i,d]=await Promise.all([
      view('snapshot'),view('incidentSnapshot'),view('incidentDeficits')]);
    return {
      version:String(s[0]),a:String(s[1]),b:String(s[2]),c:String(s[3]),
      budget:String(s[4]),reserveFloor:String(s[5]),
      incident:{phase:String(i[0]),id:String(i[1]),market:String(i[2]),
        maximum:String(i[3]),reserveMinimum:String(i[4])},
      deficits:{exposure:String(d[0]),reserve:String(d[1])},
    };
  }
  return {state,view,transact,iface,contract:address.toString(),
    provenance:{bytecodeSha256:createHash('sha256').update(raw).digest('hex'),
      abiSha256:createHash('sha256').update(JSON.stringify(abi)).digest('hex')},
    addresses:Object.fromEntries(Object.entries(callers).map(([k,v])=>[k,v.toString()]))};
}
