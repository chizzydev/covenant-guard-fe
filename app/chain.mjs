// Covenant Control in-memory EVM runtime. All policy decisions are emitted by
// the compiled Fe contract. No JS duplicate of its invariant rules exists.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Common, Hardfork, Mainnet } from '@ethereumjs/common';
import { createLegacyTx } from '@ethereumjs/tx';
import { createAccount, createAddressFromPrivateKey, hexToBytes, bytesToHex } from '@ethereumjs/util';
import { createVM, runTx } from '@ethereumjs/vm';
import { Interface } from 'ethers';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artificialAdminKey = hexToBytes(`0x${'11'.repeat(32)}`);
const artificialReviewerKey = hexToBytes(`0x${'22'.repeat(32)}`);
const codeFile = resolve(root, 'artifacts', 'CovenantControl.bin');
const abiFile = resolve(root, 'artifacts', 'CovenantControl.abi.json');

export async function createLocalChain() {
  const abi = JSON.parse(readFileSync(abiFile, 'utf8'));
  const raw = readFileSync(codeFile, 'utf8').trim();
  const bytecode = raw.startsWith('0x') ? raw : `0x${raw}`;
  if (!/^0x(?:[a-fA-F0-9]{2})+$/.test(bytecode)) {
    throw new Error('Invalid Fe deployment bytecode');
  }
  const iface = new Interface(abi);
  for (const fn of ['snapshot', 'operator', 'policyConstants', 'canCommit', 'preview', 'commit', 'earlyInvalid', 'previewMigration', 'commitMigration', 'previewActions', 'commitActions', 'commitGoalActions', 'previewIncidentActions', 'commitIncidentActions']) {
    if (!iface.hasFunction(fn)) throw new Error(`Fe ABI missing ${fn}()`);
  }

  const common = new Common({ chain: Mainnet, hardfork: Hardfork.Osaka });
  const vm = await createVM({ common });
  const admin = createAddressFromPrivateKey(artificialAdminKey);
  const reviewer = createAddressFromPrivateKey(artificialReviewerKey);
  const keys = { admin: artificialAdminKey, reviewer: artificialReviewerKey };
  const callers = { admin, reviewer };

  for (const address of [admin, reviewer]) {
    await vm.stateManager.putAccount(
      address,
      createAccount({ nonce: 0n, balance: 10n ** 24n }),
    );
  }

  async function send(data, role = 'admin', destination = undefined) {
    if (!(role in callers)) throw new Error('Unknown role');
    const from = callers[role];
    const account = await vm.stateManager.getAccount(from);
    const tx = createLegacyTx({
      nonce: account.nonce,
      gasLimit: 8_000_000n,
      gasPrice: 100_000_000_000n,
      value: 0n,
      data,
      ...(destination ? { to: destination } : {}),
    }, { common }).sign(keys[role]);
    const result = await runTx(vm, { tx });
    return { ...result, transactionHash: bytesToHex(tx.hash()), sender: from.toString(), nonce: String(tx.nonce) };
  }

  const deployment = await send(bytecode);
  if (deployment.execResult.exceptionError || !deployment.createdAddress) {
    throw new Error(`Fe contract deployment reverted: ${deployment.execResult.exceptionError || 'missing address'}`);
  }
  const contractAddress = deployment.createdAddress;

  async function call(name, args = [], role = 'admin') {
    const caller = callers[role];
    const encoded = iface.encodeFunctionData(name, args);
    const result = await vm.evm.runCall({
      to: contractAddress,
      caller,
      origin: caller,
      data: hexToBytes(encoded),
      gasLimit: 8_000_000n,
      isStatic: true,
    });
    if (result.execResult.exceptionError) {
      throw new Error(`Fe ${name}() static execution reverted: ${result.execResult.exceptionError}`);
    }
    return iface.decodeFunctionResult(name, result.execResult.returnValue);
  }

  async function snapshot() {
    const d = await call('snapshot');
    const constants = await call('policyConstants');
    return {
      version: String(d[0]),
      a: String(d[1]), b: String(d[2]), c: String(d[3]),
      budget: String(d[4]), reserveFloor: String(d[5]),
      capA: String(d[6]), capB: String(d[7]), capC: String(d[8]),
      operator: String((await call('operator'))[0]),
      inputCeiling: String(constants[0]), pairedMultiplier: String(constants[1]),
    };
  }

  async function canCommit(role = 'admin') {
    if (!(role in callers)) throw new Error('Unknown role');
    return Boolean((await call('canCommit', [], role))[0]);
  }

  async function preview({ expectedVersion, a, b, c, role = 'admin' }) {
    const d = await call('preview', [expectedVersion, a, b, c]);
    const mask = Number(d[0]);
    const authorized = await canCommit(role);
    return {
      mask,
      allowed: mask === 0,
      authorized,
      eligible: mask === 0 && authorized,
      role,
      nextVersion: String(d[1]),
      total: String(d[2]),
      remaining: String(d[3]),
      from: 'Fe EVM execution (static call)',
    };
  }

  async function transact({ expectedVersion, a, b, c, role = 'admin' }) {
    const encoded = iface.encodeFunctionData('commit', [expectedVersion, a, b, c]);
    const result = await send(encoded, role, contractAddress);
    const success = !result.execResult.exceptionError;
    return {
      success,
      gasSpent: String(result.totalGasSpent),
      error: success ? null : String(result.execResult.exceptionError),
      role,
      transactionHash: result.transactionHash,
      sender: result.sender,
      nonce: result.nonce,
    };
  }

  // Flattened, canonical 3-slot instruction format; unused slots are zero.
  // All validation decisions and intermediate policy masks come from Fe.
  function migrationArguments({ expectedVersion, steps }) {
    if (!Array.isArray(steps) || steps.length < 1 || steps.length > 3) {
      throw new Error('Migration requires one to three steps');
    }
    const flattened = steps.flatMap(({market,value}) => [market,value]);
    while (flattened.length < 6) flattened.push(0n);
    return [expectedVersion, BigInt(steps.length), ...flattened];
  }

  async function previewMigration({ expectedVersion, steps, role = 'admin' }) {
    const d = await call('previewMigration', migrationArguments({ expectedVersion,steps }));
    const mask = Number(d[0]);
    const authorized = await canCommit(role);
    return {
      mask, allowed: mask === 0, authorized, eligible: mask === 0 && authorized,
      role, nextVersion: String(d[1]), total: String(d[2]), remaining: String(d[3]),
      stageMasks: [Number(d[4]), Number(d[5]), Number(d[6])].slice(0,steps.length),
      final: {a:String(d[7]),b:String(d[8]),c:String(d[9])},
      from: 'Fe previewMigration() EVM static call',
    };
  }

  async function transactMigration({ expectedVersion,steps,role = 'admin' }) {
    const encoded = iface.encodeFunctionData('commitMigration', migrationArguments({ expectedVersion,steps }));
    const result = await send(encoded,role,contractAddress);
    const success = !result.execResult.exceptionError;
    return {
      success, gasSpent:String(result.totalGasSpent),
      error:success ? null : String(result.execResult.exceptionError),
      role, transactionHash:result.transactionHash,sender:result.sender,nonce:result.nonce,
    };
  }

  // Encoded operations are validated and interpreted by Fe. JS only
  // serializes the wire representation; it never calculates policy results.
  function actionsArguments({ expectedVersion, steps }) {
    if (!Array.isArray(steps) || steps.length < 1 || steps.length > 3) {
      throw new Error('Action plan requires one to three steps');
    }
    const flattened = steps.flatMap(({opcode,amount}) => [opcode,amount]);
    while (flattened.length < 6) flattened.push(0n);
    return [expectedVersion, BigInt(steps.length), ...flattened];
  }

  async function previewActions({ expectedVersion, steps, role = 'admin' }) {
    const d = await call('previewActions', actionsArguments({expectedVersion,steps}));
    const mask = Number(d[0]);
    const authorized = await canCommit(role);
    return {
      mask, allowed:mask === 0, authorized, eligible:mask === 0 && authorized,
      role, nextVersion:String(d[1]), total:String(d[2]), remaining:String(d[3]),
      stageMasks:[Number(d[4]),Number(d[5]),Number(d[6])].slice(0,steps.length),
      final:{a:String(d[7]),b:String(d[8]),c:String(d[9])},
      operationError:Number(d[10]),
      from:'Fe previewActions() EVM static call',
    };
  }

  async function transactActions({ expectedVersion, steps, role = 'admin' }) {
    const encoded = iface.encodeFunctionData('commitActions', actionsArguments({expectedVersion,steps}));
    const result = await send(encoded,role,contractAddress);
    const success = !result.execResult.exceptionError;
    return {
      success, gasSpent:String(result.totalGasSpent),
      error:success ? null : String(result.execResult.exceptionError),
      role, transactionHash:result.transactionHash,sender:result.sender,nonce:result.nonce,
    };
  }

  async function transactGoalActions({ expectedVersion, steps, target, role = 'admin' }) {
    const args = [...actionsArguments({expectedVersion,steps}),
      BigInt(target.a),BigInt(target.b),BigInt(target.c)];
    const encoded = iface.encodeFunctionData('commitGoalActions',args);
    const result = await send(encoded,role,contractAddress);
    const success=!result.execResult.exceptionError;
    return {
      success,gasSpent:String(result.totalGasSpent),
      error:success?null:String(result.execResult.exceptionError),
      role,transactionHash:result.transactionHash,sender:result.sender,nonce:result.nonce,
    };
  }

  // v1.7: the contract independently validates the incident specification
  // against the resulting allocation. The intent is still operator-supplied:
  // no external risk-feed authentication is claimed.
  function incidentArguments({expectedVersion,steps,target,incident}) {
    return [...actionsArguments({expectedVersion,steps}),
      BigInt(target.a),BigInt(target.b),BigInt(target.c),
      BigInt(incident.market),BigInt(incident.maximum),BigInt(incident.reserve)];
  }

  async function previewIncidentActions({expectedVersion,steps,target,incident,role='admin'}) {
    const d=await call('previewIncidentActions',incidentArguments({expectedVersion,steps,target,incident}));
    const mask=Number(d[0]),operationError=Number(d[1]),incidentMask=Number(d[2]);
    const goalMatches=Boolean(d[3]);
    const authorized=await canCommit(role);
    return {
      mask,operationError,incidentMask,goalMatches,authorized,
      eligible:mask===0&&operationError===0&&incidentMask===0&&goalMatches&&authorized,
      role,final:{a:String(d[4]),b:String(d[5]),c:String(d[6])},
      from:'Fe previewIncidentActions() EVM static call',
    };
  }

  async function transactIncidentActions({expectedVersion,steps,target,incident,role='admin'}) {
    const args=incidentArguments({expectedVersion,steps,target,incident});
    const encoded=iface.encodeFunctionData('commitIncidentActions',args);
    const result=await send(encoded,role,contractAddress);
    const success=!result.execResult.exceptionError;
    return {
      success,gasSpent:String(result.totalGasSpent),
      error:success?null:String(result.execResult.exceptionError),
      role,transactionHash:result.transactionHash,sender:result.sender,nonce:result.nonce,
    };
  }

  return {
    snapshot, preview, canCommit, transact, previewMigration, transactMigration,
    previewActions, transactActions, transactGoalActions, previewIncidentActions, transactIncidentActions,
    details: {
      address: contractAddress.toString(),
      admin: admin.toString(),
      reviewer: reviewer.toString(),
      hardfork: 'osaka',
      deploymentGas: String(deployment.totalGasSpent),
      bytecodeBytes: (bytecode.length - 2) / 2,
      engine: '@ethereumjs/vm 10.1.3',
      chain: 'isolated in-memory EVM',
    },
  };
}
