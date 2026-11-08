// P06-R4: single allocation runtime; every allocation HTTP write goes through
// AllocationFlagship (the Fe Guard3 consumer). Policy and incident decisions
// are always evaluated in the compiled Fe contract, never in this adapter.
import { createFlagshipCandidate } from './flagship-candidate.mjs';
import { candidatePlans } from './lib/planner.mjs';

// Legacy display codes differ from the generic Fe mask. 64 is stale in Guard3
// but 16 in the old UI; 256 denotes an operation error but 64 in old UI.
// Preserve the incident transition bit 128 separately and NEVER strip it.
export function legacyMask(raw) {
  const mask=Number(raw);
  return (mask & 15) | (mask & 32) | (mask & 64 ? 16 : 0) |
    (mask & 16 ? 512 : 0) | (mask & 128) | (mask & 256 ? 64 : 0);
}
function identity(s) {
  return {
    version:s.version,a:s.a,b:s.b,c:s.c,
    incident:s.incident,deficits:s.deficits,
  };
}
function actionArgs({expectedVersion,steps}) {
  if(!Array.isArray(steps)||steps.length<1||steps.length>3) throw Error('Action plan requires one to three steps');
  const values=steps.flatMap(s=>[BigInt(s.opcode),BigInt(s.amount)]);
  while(values.length<6) values.push(0n);
  return [BigInt(expectedVersion),BigInt(steps.length),...values];
}
function migrationArgs({expectedVersion,steps}) {
  if(!Array.isArray(steps)||steps.length<1||steps.length>3) throw Error('Migration requires one to three steps');
  const values=steps.flatMap(s=>[BigInt(s.market),BigInt(s.value)]);
  while(values.length<6) values.push(0n);
  return [BigInt(expectedVersion),BigInt(steps.length),...values];
}
function goalArgs({expectedVersion,steps,target}) {
  return [...actionArgs({expectedVersion,steps}),BigInt(target.a),BigInt(target.b),BigInt(target.c)];
}
export async function createFlagshipRuntime() {
  const f=await createFlagshipCandidate();
  const [constants,operator,guardian]=await Promise.all([
    f.view('policyConstants'),f.view('operator'),f.view('guardian')]);
  const base={inputCeiling:String(constants[0]),pairedMultiplier:String(constants[1]),
    operator:String(operator[0]),guardian:String(guardian[0]),
    capA:'550',capB:'500',capC:'350'};
  // Caps are immutable constructor rules in the compiled flagship. The
  // snapshot still provides their actual runtime values, checked below.
  async function snapshot() {
    const [s,full]=await Promise.all([f.state(),f.view('snapshot')]);
    if(String(full[6])!==base.capA||String(full[7])!==base.capB||String(full[8])!==base.capC) {
      throw Error('FLAGSHIP_RULE_SNAPSHOT_MISMATCH');
    }
    return {...s, ...base, capA:String(full[6]),capB:String(full[7]),capC:String(full[8])};
  }
  async function canCommit(role='admin') {
    return Boolean((await f.view('canCommit',[],role))[0]);
  }
  function receipt(result,role,method) {
    return {...result,role,method};
  }
  async function write(method,args,role='admin') {
    return receipt(await f.transact(method,args,role),role,method);
  }
  function overview(d,role,authorized,method) {
    const mask=legacyMask(d[0]);
    return {mask,allowed:mask===0,authorized,eligible:mask===0&&authorized,
      role,nextVersion:String(d[1]),total:String(d[2]),remaining:String(d[3]),
      from:`Fe ${method}() static EVM call; persisted Guard3 policy`};
  }
  async function preview({expectedVersion,a,b,c,role='admin'}) {
    const d=await f.view('preview',[expectedVersion,a,b,c],role);
    return overview(d,role,await canCommit(role),'preview');
  }
  async function transact({expectedVersion,a,b,c,role='admin'}) {
    return write('commit',[expectedVersion,a,b,c],role);
  }
  async function previewMigration({expectedVersion,steps,role='admin'}) {
    const d=await f.view('previewMigration',migrationArgs({expectedVersion,steps}),role);
    return {...overview(d,role,await canCommit(role),'previewMigration'),
      stageMasks:[Number(d[4]),Number(d[5]),Number(d[6])].slice(0,steps.length),
      final:{a:String(d[7]),b:String(d[8]),c:String(d[9])}};
  }
  async function transactMigration({expectedVersion,steps,role='admin'}) {
    return write('commitMigration',migrationArgs({expectedVersion,steps}),role);
  }
  async function previewActions({expectedVersion,steps,role='admin'}) {
    const d=await f.view('previewActions',actionArgs({expectedVersion,steps}),role);
    return {...overview(d,role,await canCommit(role),'previewActions'),
      stageMasks:[Number(d[4]),Number(d[5]),Number(d[6])].slice(0,steps.length),
      final:{a:String(d[7]),b:String(d[8]),c:String(d[9])},operationError:Number(d[10])};
  }
  async function transactActions({expectedVersion,steps,role='admin'}) {
    return write('commitActions',actionArgs({expectedVersion,steps}),role);
  }
  async function transactGoalActions({expectedVersion,steps,target,role='admin'}) {
    return write('commitGoalActions',goalArgs({expectedVersion,steps,target}),role);
  }
  function incidentArgs({expectedVersion,steps,target,incident}) {
    return [...goalArgs({expectedVersion,steps,target}),
      BigInt(incident.market),BigInt(incident.maximum),BigInt(incident.reserve)];
  }
  async function previewIncidentActions({expectedVersion,steps,target,incident,role='admin'}) {
    const d=await f.view('previewIncidentActions',incidentArgs({expectedVersion,steps,target,incident}),role);
    const mask=legacyMask(d[0]),operationError=Number(d[1]),incidentMask=Number(d[2]);
    const goalMatches=Boolean(d[3]),authorized=await canCommit(role);
    const current=await snapshot();
    const active=Number(current.incident.phase)!==0;
    const matches=active&&current.incident.market===String(incident.market)&&
      current.incident.maximum===String(incident.maximum)&&
      current.incident.reserveMinimum===String(incident.reserve);
    return {mask,operationError,incidentMask,goalMatches,authorized,
      active,matchesStoredObjective:matches,
      eligible:active&&matches&&mask===0&&operationError===0&&incidentMask===0&&goalMatches&&authorized,
      role,final:{a:String(d[4]),b:String(d[5]),c:String(d[6])},
      from:'Fe previewIncidentActions() EVM static call; stored incident checked by Fe'};
  }
  async function transactIncidentActions({expectedVersion,steps,target,incident,role='admin'}) {
    // Never activate an incident on behalf of an operator. The Fe contract
    // also fails closed on inactive or mismatched stored objectives.
    return write('commitIncidentActions',incidentArgs({expectedVersion,steps,target,incident}),role);
  }
  async function guardState() {
    const s=await snapshot();
    return {domain:'allocation',version:s.version,x:s.a,y:s.b,z:s.c,
      incident:{phase:Number(s.incident.phase),id:s.incident.id,market:s.incident.market,
        maximum:s.incident.maximum,bufferMinimum:s.incident.reserveMinimum},
      deficits:{exposure:s.deficits.exposure,buffer:s.deficits.reserve},
      operator:s.operator,guardian:s.guardian,contract:f.contract,
      ruleDescription:'Core / Supporting / Satellite; private Fe Guard3 and persistent incident; shared with the seven-view flagship'};
  }
  async function guardPreview({expected,x,y,z,role}) {
    const p=await preview({expectedVersion:expected,a:x,b:y,c:z,role});
    return {mask:p.mask,allowed:p.allowed,authorized:p.authorized,eligible:p.eligible,
      nextVersion:p.nextVersion,previewX:String(x),previewY:String(y),
      source:'AllocationFlagship::preview() Fe static call'};
  }
  async function guardCommit({expected,x,y,z,role}) {
    return transact({expectedVersion:expected,a:x,b:y,c:z,role});
  }
  async function guardMigrate({expected,first,firstValue,second,secondValue,role}) {
    return transactMigration({expectedVersion:expected,
      steps:[{market:first,value:firstValue},{market:second,value:secondValue}],role});
  }
  async function guardActivate({expected,mode,market,maximum,bufferMinimum,target,role}) {
    if(mode==='progressive') {
      return write('activateProgressive',[expected,market,maximum,bufferMinimum],role);
    }
    if(mode!=='atomic'||!target) throw Error('GUARD_INVALID_ACTIVATION_MODE');
    const s=await snapshot();
    const targetObject={a:String(target.x),b:String(target.y),c:String(target.z)};
    const plans=candidatePlans(s,{kind:'target',...targetObject},
      [BigInt(targetObject.a),BigInt(targetObject.b),BigInt(targetObject.c)]);
    // For an already-satisfied target, an EXPECT is a valid Fe transition
    // proving that the current slot remains as asserted.
    for (const steps of plans) {
      const effective=steps.length?steps:[{opcode:'15',amount:s.a}];
      const p=await previewActions({expectedVersion:expected,steps:effective,role:'admin'});
      if(p.mask!==0||p.operationError!==0||
        ['a','b','c'].some(k=>p.final[k]!==targetObject[k])) continue;
      const a=actionArgs({expectedVersion:expected,steps:effective});
      return write('activateContain',[BigInt(expected),market,maximum,bufferMinimum,
        ...a.slice(1),BigInt(target.x),BigInt(target.y),BigInt(target.z)],role);
    }
    throw Error('GUARD_ATOMIC_TARGET_HAS_NO_VERIFIED_THREE_OPERATION_PLAN');
  }
  async function guardRelease({expected,incidentId,role}) {
    return write('releaseIncidentBound',[expected,incidentId],role);
  }
  return {snapshot,canCommit,preview,transact,previewMigration,transactMigration,
    previewActions,transactActions,transactGoalActions,
    previewIncidentActions,transactIncidentActions,guardState,guardPreview,
    guardCommit,guardMigrate,guardActivate,guardRelease,
    // Used only for audit rollback assertions and cross-surface identity.
    protectedState:async()=>identity(await snapshot()),
    details:{address:f.contract,admin:f.addresses.admin,reviewer:f.addresses.reviewer,
      guardian:f.addresses.guardian,chain:'disposable local EVM',
      engine:'AllocationFlagship / covenant_transition::Guard3; one allocation state',
      contract:f.contract,guardLibrary:'covenant_transition::Guard3',
      hardfork:'osaka',deploymentGas:'local; see Fe EVM receipts'},
  };
}
