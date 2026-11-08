// P06: real Fe Guard3 consumer bytecode executed by disposable EthereumJS VMs.
// This bridge serializes ABI data; it does NOT implement Fe policy predicates.
// Two different contracts import the same Fe library. No test guardian forwarders
// are deployed; the guardian is a distinct disposable EOA used by this sandbox.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Common, Hardfork, Mainnet } from '@ethereumjs/common';
import { createLegacyTx } from '@ethereumjs/tx';
import { createAccount, createAddressFromPrivateKey, hexToBytes, bytesToHex } from '@ethereumjs/util';
import { createVM, runTx } from '@ethereumjs/vm';
import { Interface, AbiCoder } from 'ethers';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = {
  admin: hexToBytes(`0x${'11'.repeat(32)}`),
  reviewer: hexToBytes(`0x${'22'.repeat(32)}`),
  guardian: hexToBytes(`0x${'33'.repeat(32)}`),
};
const allowedDomains = Object.freeze({
  allocation: {
    artifact: 'AllocationPilot', folder: 'allocation',
    write: 'setAllocation', migration: 'reallocate',
    progressive: 'activateRecovery', atomic: 'activateAtomicRecovery', release: 'releaseRecovery',
    policy: 'x = Core, y = Supporting, z = Satellite; unallocated budget is emergency buffer',
  },
  governance: {
    artifact: 'GovernanceRegistry', folder: 'governance',
    write: 'setConfiguration', migration: 'changeQuorumAndMembers',
    progressive: 'activateRestriction', atomic: 'activateAtomicRestriction', release: 'releaseRestriction',
    policy: 'x = Quorum, y = Members, z = Execution Delay; execution delay is emergency buffer',
  },
});

export async function createGuardChain({ allocationBridge = null } = {}) {
  const common = new Common({ chain: Mainnet, hardfork: Hardfork.Osaka });
  const vm = await createVM({ common });
  const keys = fixtures;
  const callers = Object.fromEntries(Object.entries(keys).map(([name, key]) => [name, createAddressFromPrivateKey(key)]));
  for (const address of Object.values(callers)) {
    // In integrated mode, use a distinct synthetic deployment nonce so the
    // governance sandbox address cannot misleadingly equal the flagship's
    // address on its separate disposable EVM. No transaction is submitted.
    await vm.stateManager.putAccount(address, createAccount({ nonce: allocationBridge && address.toString() === callers.admin.toString() ? 1n : 0n, balance: 10n ** 24n }));
  }

  async function send(data, role, destination) {
    if (!Object.hasOwn(callers, role)) throw Error('GUARD_UNKNOWN_ROLE');
    const account = await vm.stateManager.getAccount(callers[role]);
    const tx = createLegacyTx({
      nonce: account.nonce, gasLimit: 8_000_000n, gasPrice: 100_000_000_000n,
      value: 0n, data, ...(destination ? { to: destination } : {}),
    }, { common }).sign(keys[role]);
    const result = await runTx(vm, { tx });
    return {
      success: !result.execResult.exceptionError,
      error: result.execResult.exceptionError ? String(result.execResult.exceptionError) : null,
      gasSpent: String(result.totalGasSpent),
      transactionHash: bytesToHex(tx.hash()),
      sender: callers[role].toString(), role, _createdAddress: result.createdAddress,
    };
  }

  const contracts = {};
  for (const [domain, meta] of Object.entries(allowedDomains)) {
    if (domain === 'allocation' && allocationBridge) continue;
    const prefix = resolve(root, 'artifacts', 'guard', meta.folder, meta.artifact);
    const hex = readFileSync(`${prefix}.bin`, 'utf8').trim();
    const abi = JSON.parse(readFileSync(`${prefix}.abi.json`, 'utf8'));
    const iface = new Interface(abi);
    if (!/^(?:0x)?(?:[0-9a-f]{2})+$/i.test(hex)) throw Error(`GUARD_BAD_BYTECODE=${domain}`);
    const bytecode = hex.startsWith('0x') ? hex : `0x${hex}`;
    if (iface.deploy.inputs.length !== 1 || iface.deploy.inputs[0].type !== 'address') {
      throw Error(`GUARD_CONSTRUCTOR_ABI_NOT_GUARDIAN_ADDRESS=${domain}`);
    }
    for (const name of ['snapshot', 'incidentSnapshot', 'deficits', 'preview',
      'operator', 'guardian', meta.write, meta.progressive, meta.atomic, meta.release, meta.migration]) {
      if (!iface.hasFunction(name)) throw Error(`GUARD_MISSING_ABI=${domain}:${name}`);
    }
    // Constructor's address is the genuine guardian EOA, NOT a permissive
    // forwarder. This local server owns all demo keys; do not deploy publicly.
    const ctor = AbiCoder.defaultAbiCoder().encode(['address'], [callers.guardian.toString()]);
    const deployed = await send(`${bytecode}${ctor.slice(2)}`, 'admin');
    if (!deployed.success || !deployed._createdAddress) {
      throw Error(`GUARD_DEPLOY_FAILED=${domain}:${deployed.error || "missing address"}`);
    }
    const address = deployed._createdAddress;
    contracts[domain] = { iface, meta, bytecode, address, deployment: deployed };
  }

  function get(domain) {
    if (!Object.hasOwn(contracts, domain)) throw Error('GUARD_UNKNOWN_DOMAIN');
    return contracts[domain];
  }
  function roleAddress(role) {
    if (!Object.hasOwn(callers, role)) throw Error('GUARD_UNKNOWN_ROLE');
    return callers[role];
  }
  async function view(domain, name, args = [], role = 'reviewer') {
    const c = get(domain);
    const caller = roleAddress(role);
    const encoded = c.iface.encodeFunctionData(name, args);
    const result = await vm.evm.runCall({
      to: c.address, caller, origin: caller,
      data: hexToBytes(encoded), gasLimit: 8_000_000n, isStatic: true,
    });
    if (result.execResult.exceptionError) {
      throw Error(`GUARD_STATIC_REVERT=${domain}:${name}:${result.execResult.exceptionError}`);
    }
    return c.iface.decodeFunctionResult(name, result.execResult.returnValue);
  }
  async function state(domain) {
    if (domain === 'allocation' && allocationBridge) return allocationBridge.guardState();
    const c = get(domain);
    const s = await view(domain, 'snapshot');
    const incident = await view(domain, 'incidentSnapshot');
    const deficits = await view(domain, 'deficits');
    const op = await view(domain, 'operator');
    const guardian = await view(domain, 'guardian');
    return {
      domain, version: String(s[0]), x: String(s[1]), y: String(s[2]), z: String(s[3]),
      incident: {
        phase: Number(incident[0]), id: String(incident[1]), market: String(incident[2]),
        maximum: String(incident[3]), bufferMinimum: String(incident[4]),
      },
      deficits: { exposure: String(deficits[0]), buffer: String(deficits[1]) },
      operator: String(op[0]), guardian: String(guardian[0]),
      contract: c.address.toString(), ruleDescription: c.meta.policy,
    };
  }
  async function bothStates() {
    return { allocation: await state('allocation'), governance: await state('governance') };
  }
  async function preview({ domain, expected, x, y, z, role }) {
    if (domain === 'allocation' && allocationBridge) return allocationBridge.guardPreview({expected,x,y,z,role});
    const c = get(domain);
    const raw = await view(domain, 'preview', [expected, x, y, z], role);
    const op = await view(domain, 'operator', [], role);
    const authorized = String(op[0]).toLowerCase() === roleAddress(role).toString().toLowerCase();
    const mask = Number(raw[0]);
    return {
      mask, allowed: mask === 0, authorized, eligible: mask === 0 && authorized,
      nextVersion: String(raw[1]), previewX: String(raw[2]), previewY: String(raw[3]),
      source: 'Fe Guard3 static EVM call; authorization comparison is UI-only',
    };
  }
  async function execute({ domain, method, args, role }) {
    const c = get(domain);
    const encoded = c.iface.encodeFunctionData(method, args);
    const { _createdAddress, ...receipt } = await send(encoded, role, c.address);
    return { ...receipt, method, domain };
  }
  async function commit({ domain, expected, x, y, z, role }) {
    if (domain === 'allocation' && allocationBridge) return allocationBridge.guardCommit({expected,x,y,z,role});
    return execute({ domain, method: get(domain).meta.write, args: [expected,x,y,z], role });
  }
  async function migrate({ domain, expected, first, firstValue, second, secondValue, role }) {
    if (domain === 'allocation' && allocationBridge) return allocationBridge.guardMigrate({expected,first,firstValue,second,secondValue,role});
    const meta = get(domain).meta;
    if (domain === 'allocation') {
      return execute({ domain, method: meta.migration,
        args: [expected,first,firstValue,second,secondValue],role });
    }
    // Governance's migration updates members and quorum in an enforced order.
    if (first !== 1n || second !== 0n) throw Error('GUARD_GOVERNANCE_MIGRATION_REQUIRES_MEMBERS_THEN_QUORUM');
    return execute({domain, method:meta.migration,args:[expected,firstValue,secondValue],role});
  }
  async function activate({ domain, expected, mode, market, maximum, bufferMinimum,
    target, role }) {
    if (domain === 'allocation' && allocationBridge) return allocationBridge.guardActivate({expected,mode,market,maximum,bufferMinimum,target,role});
    const c = get(domain);
    if (mode !== 'atomic' && mode !== 'progressive') throw Error('GUARD_INVALID_ACTIVATION_MODE');
    if (domain === 'governance' && market !== 0n) throw Error('GUARD_GOVERNANCE_MARKET_MUST_BE_ZERO');
    const args = domain === 'allocation' ? [expected,market,maximum,bufferMinimum] :
      [expected,maximum,bufferMinimum];
    if (mode === 'atomic') {
      if (!target) throw Error('GUARD_ATOMIC_TARGET_REQUIRED');
      args.push(target.x,target.y,target.z);
    }
    return execute({domain,method:mode === 'atomic' ? c.meta.atomic : c.meta.progressive,
      args,role});
  }
  async function release({ domain, expected, incidentId, role }) {
    if (domain === 'allocation' && allocationBridge) return allocationBridge.guardRelease({expected,incidentId,role});
    return execute({domain,method:get(domain).meta.release,args:[expected,incidentId],role});
  }
  return {
    state,bothStates,preview,commit,migrate,activate,release,
    details: {
      chain: allocationBridge ? 'one flagship allocation VM and an independent governance VM; no public RPC' : 'disposable in-memory EVM; no public RPC',
      walletAccess: 'demo server controls three synthetic private keys, not real authentication',
      guardLibrary: 'covenant_transition::Guard3 from the one P05 ingot',
      addresses: Object.fromEntries(Object.entries(callers).map(([k,v])=>[k,v.toString()])),
      contracts: {
        ...(allocationBridge ? {allocation:{address:allocationBridge.details.address,
          source:"AllocationFlagship single-state allocation"}} : {}),
        ...Object.fromEntries(Object.entries(contracts).map(([k,v])=>[k,{
        address:v.address.toString(),
        deploymentGas:v.deployment.gasSpent,
        bytecodeSha256:createHash('sha256').update(hexToBytes(v.bytecode)).digest('hex'),
      }])),
      },
    },
  };
}
