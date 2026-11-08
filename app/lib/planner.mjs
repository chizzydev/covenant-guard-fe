// Covenant Control v1.5 — deterministic planning arithmetic, NOT policy logic.
// Only Fe EVM previewActions() decides whether a candidate is valid. The goal
// target is rechecked atomically inside Fe commitGoalActions().
import { createHash } from 'node:crypto';
const names = ['Core','Supporting','Satellite'];
const plain = x => String(x);
function coords(state) { return [BigInt(state.a),BigInt(state.b),BigInt(state.c)]; }
export function deriveTarget(state, goal) {
  const values = coords(state);
  if (goal.kind === 'target') return [BigInt(goal.a),BigInt(goal.b),BigInt(goal.c)];
  if (goal.kind !== 'shift') throw Error('Unknown objective kind');
  const from = Number(goal.source), to = Number(goal.destination);
  const amount = BigInt(goal.quantity);
  if (from === to) throw Error('The source and destination must be different');
  if (from < 0 || to < 0 || from > 2 || to > 2) throw Error('Invalid market selection');
  if (amount <= 0n) throw Error('Move quantity must be positive');
  const target = [...values];
  target[from] -= amount;
  target[to] += amount;
  return target;
}
export function targetObject(target) { return {a:plain(target[0]),b:plain(target[1]),c:plain(target[2])}; }
function transfer(source,destination,amount) { return {opcode:plain(source*3+destination),amount:plain(amount)}; }
function retire(market,amount) { return {opcode:plain(9+market),amount:plain(amount)}; }
function issue(market,amount) { return {opcode:plain(12+market),amount:plain(amount)}; }
function permutations(items) {
  if (items.length <= 1) return [items];
  return items.flatMap((item,i) => permutations(items.filter((_,j)=>i!==j)).map(rest => [item,...rest]));
}
export function candidatePlans(state, goal, target) {
  const current = coords(state);
  if (target.some(x=>x<0n)) return [];
  if (target.every((x,i)=>x===current[i])) return [[]];
  if (goal.kind === 'shift') {
    return [[transfer(Number(goal.source),Number(goal.destination),BigInt(goal.quantity))]];
  }
  const surplus = current.map((v,i)=>({market:i,units:v>target[i]?v-target[i]:0n})).filter(x=>x.units>0n);
  const deficit = current.map((v,i)=>({market:i,units:target[i]>v?target[i]-v:0n})).filter(x=>x.units>0n);
  const moves=[];
  // Net matching minimizes external resource transfers and needs at most
  // three operations with three markets plus the unallocated pool.
  for(const source of surplus) {
    for (const dest of deficit) {
      const amount = source.units < dest.units ? source.units : dest.units;
      if(amount<=0n) continue;
      moves.push(transfer(source.market,dest.market,amount));
      source.units-=amount;dest.units-=amount;
    }
  }
  for (const source of surplus) if(source.units>0n) moves.push(retire(source.market,source.units));
  for (const dest of deficit) if(dest.units>0n) moves.push(issue(dest.market,dest.units));
  if(moves.length>3) return [];
  // Explore alternative valid execution orders through Fe, never accept a
  // JS-simulated outcome as authority.
  return [...new Map(permutations(moves).map(steps => [JSON.stringify(steps),steps])).values()];
}
export function fingerprint({goal,expectedVersion,target,steps}) {
  return createHash('sha256').update(JSON.stringify({goal,expectedVersion:String(expectedVersion),target,steps})).digest('hex');
}
export function describeGoal(goal,target) {
  return goal.kind==='shift'
    ? `Move ${goal.quantity} units from ${names[Number(goal.source)]} to ${names[Number(goal.destination)]}`
    : `Reach ${target.a} / ${target.b} / ${target.c} exactly`;
}
export function summarizeMask(mask) {
  const failures = [[1,'global capacity'],[2,'market ceiling'],[4,'protected reserve'],[8,'paired exposure'],[16,'stale version'],[32,'input ceiling'],[64,'operation precondition']];
  return failures.filter(([bit])=>(mask & bit)!==0).map(([,reason])=>reason);
}
// Input is already schema-validated by the HTTP boundary.
export async function planFromFe({state,goal,role,previewActions}) {
  const target = deriveTarget(state,goal);
  const targetFields = targetObject(target);
  const expectedVersion=String(state.version);
  const objective=describeGoal(goal,targetFields);
  const base={goal,target:targetFields,objective,expectedVersion,role,from:targetObject(coords(state))};
  if(target.some(v=>v<0n)) {
    // Even this impossible arithmetic goal gets an authentic Fe operation
    // diagnosis: the source market cannot transfer what it does not hold.
    const steps=[transfer(Number(goal.source),Number(goal.destination),BigInt(goal.quantity))];
    const preview=await previewActions({expectedVersion,steps,role});
    if(preview.operationError!==20) throw Error('PLANNER_SOURCE_CAPACITY_DIAGNOSTIC_MISMATCH');
    return {...base,status:'infeasible',reason:'Fe rejected step 1: insufficient capacity in the source market.',
      steps,preview,evaluated:1,goalMatches:false};
  }
  if(target.some(v=>v>BigInt(state.inputCeiling))) return {...base,status:'infeasible',reason:'A target exceeds the Fe input ceiling.',steps:[],evaluated:0};
  const candidates=candidatePlans(state,goal,target);
  if(candidates.length===1 && candidates[0].length===0) return {...base,status:'already_satisfied',reason:'The goal is already satisfied; no transaction is necessary.',steps:[],evaluated:0};
  if(!candidates.length) return {...base,status:'infeasible',reason:'No three-operation plan can meet this target.',steps:[],evaluated:0};
  let chosen=null,evaluated=0;
  for(const steps of candidates) {
    const p=await previewActions({expectedVersion,steps,role});evaluated++;
    const goalMatches = ['a','b','c'].every(k=>p.final[k]===targetFields[k]);
    if(p.operationError===0 && p.mask===0 && !goalMatches) throw Error('PLANNER_FE_PREVIEW_GOAL_MISMATCH');
    const candidate={steps,preview:p,goalMatches};
    // Prefer a feasible candidate; otherwise preserve the most informative
    // Fe failure (a completed plan with an unsafe final state).
    if(!chosen || (p.operationError===0 && chosen.preview.operationError!==0)) chosen=candidate;
    if(p.mask===0 && p.operationError===0 && goalMatches) {chosen=candidate;break;}
  }
  const {steps,preview,goalMatches}=chosen;
  const status=preview.mask===0 && preview.operationError===0 && goalMatches
    ? preview.authorized?'ready':'unauthorized':'infeasible';
  const reason=status==='ready'?'Fe confirms the operations and final policy. The target will also be asserted inside the commit transaction.'
    :status==='unauthorized'?'The goal is feasible, but the selected signer is not authorized by Fe.'
    :preview.operationError?`Fe rejected operation ${Math.floor(preview.operationError/16)} (code ${preview.operationError%16}).`
    :`Fe rejected the final policy: ${summarizeMask(preview.mask).join(', ') || 'target mismatch'}.`;
  return {...base,status,reason,steps,preview,evaluated,goalMatches,
    digest:fingerprint({goal,expectedVersion,target:targetFields,steps})};
}
