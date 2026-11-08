import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync,writeFileSync}from'node:fs';
import{Common,Hardfork,Mainnet}from'@ethereumjs/common';import{createLegacyTx}from'@ethereumjs/tx';import{createAccount,createAddressFromPrivateKey,hexToBytes,bytesToHex}from'@ethereumjs/util';import{createVM,runTx}from'@ethereumjs/vm';import{AbiCoder}from'ethers';
test('P09 safe external call executes after projection finalization',async()=>{
 const common=new Common({chain:Mainnet,hardfork:Hardfork.Osaka}),vm=await createVM({common}),key=hexToBytes('0x'+'11'.repeat(32)),address=createAddressFromPrivateKey(key);
 await vm.stateManager.putAccount(address,createAccount({nonce:0n,balance:10n**24n}));
 const prefix='artifacts/p09/positive/IllegalCall';
 async function send(data,to){const account=await vm.stateManager.getAccount(address);const tx=createLegacyTx({nonce:account.nonce,gasLimit:8000000n,gasPrice:100000000000n,value:0n,data,...(to?{to}:{})},{common}).sign(key);const result=await runTx(vm,{tx});assert.equal(result.execResult.exceptionError,undefined);return {result,hash:bytesToHex(tx.hash())}}
 const deployed=await send('0x'+readFileSync(prefix+'.bin','utf8').trim().replace(/^0x/,''));const contract=deployed.result.createdAddress;
 const receipt=await send('0x12345678'+AbiCoder.defaultAbiCoder().encode(['address'],[address.toString()]).slice(2),contract);
 const stored=bytesToHex(await vm.stateManager.getStorage(contract,new Uint8Array(32)));assert.equal(BigInt(stored==='0x'?'0x0':stored),2n);
 writeFileSync('results/p09/positive-access-runtime.json',JSON.stringify({transactionHash:receipt.hash,stored,meaning:'Projection writes back before external execution; no access is live across the call.'},null,2));
});
