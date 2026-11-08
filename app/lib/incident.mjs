// Covenant Control v1.6 — operator-entered market exposure incident.
// This is a candidate generator, not an on-chain safety oracle or live alert feed.
// Both Fe previewActions() and Fe previewIncidentActions() validate candidates.
// Fe commitIncidentActions() independently enforces the supplied incident goal.
import { createHash } from 'node:crypto';
import { planFromFe } from './planner.mjs';

const NAMES=['Core','Supporting','Satellite'];
export const INCIDENT_STRATEGIES=Object.freeze([
  {id:'continuity',title:'Keep capacity active',caption:'Reassign released exposure where other markets have room, retiring only what the reserve target requires.'},
  {id:'spread',title:'Spread remaining exposure',caption:'Prefer lower concentration across the two unaffected markets, while respecting the reserve objective.'},
  {id:'reserve',title:'Build protective reserve',caption:'Retire the released exposure instead of redeploying it; sacrifice utilization for a larger unallocated buffer.'},
]);
const STRATEGY_IDS=new Set(INCIDENT_STRATEGIES.map(s=>s.id));
const asBig=v=>BigInt(String(v));
const stateValues=s=>[asBig(s.a),asBig(s.b),asBig(s.c)];
const sum=a=>a.reduce((x,y)=>x+y,0n);
const max=(a,b)=>a>b?a:b;
const min=(a,b)=>a<b?a:b;
const stringTarget=values=>({a:String(values[0]),b:String(values[1]),c:String(values[2])});
const key=t=>`${t.a}/${t.b}/${t.c}`;
function cap(state,index) { return asBig(state[`cap${'ABC'[index]}`]); }
function utilization(state,target,index) {
  const ceiling=Number(cap(state,index));
  return ceiling===0?Number.POSITIVE_INFINITY:Number(target[index])/ceiling;
}
function strategiesById(id) {
  const found=INCIDENT_STRATEGIES.find(s=>s.id===id);
  if(!found) throw Error('Unknown incident response strategy');
  return found;
}
export function responseFingerprint({incident,strategy,expectedVersion,plan}) {
  if(!STRATEGY_IDS.has(strategy)) throw Error('Unknown incident response strategy');
  return createHash('sha256').update(JSON.stringify({
    incident,strategy,expectedVersion:String(expectedVersion),
    goalFingerprint:plan.digest,terminal:plan.target,orderedSteps:plan.steps,
  })).digest('hex');
}
// Inputs have already passed the HTTP decimal and market checks.
// Headroom and reserve calculations only COMPOSE candidate targets; they do
// not grant permission to commit, substitute for Fe, or trust an external feed.
export function incidentCandidates(state,incident) {
  const index=Number(incident.market);
  if(!Number.isInteger(index)||index<0||index>2) throw Error('Affected market must be Core, Supporting, or Satellite');
  const current=stateValues(state);
  const budget=asBig(state.budget);
  const minimum=asBig(incident.reserve);
  const exposureMax=asBig(incident.maximum);
  if(minimum<asBig(state.reserveFloor)) throw Error(`Requested reserve must be at least the Fe-defined floor of ${state.reserveFloor}`);
  if(minimum>budget) throw Error('Requested reserve exceeds the entire policy budget');
  if(exposureMax<0n || exposureMax>asBig(state.inputCeiling)) throw Error('Incident limit is outside the input safety domain');
  const unallocated=budget-sum(current);
  const toRelease=max(current[index]-exposureMax,minimum-unallocated);
  const release=max(toRelease,0n);
  const reserveGap=max(minimum-unallocated,0n);
  const base={affected:NAMES[index],current:stringTarget(current),currentReserve:String(unallocated),
    release:String(release),reserveGap:String(reserveGap)};
  if(release===0n) return {...base,status:'already_contained',reason:'Current Fe state already meets the requested incident exposure limit and reserve objective.',candidates:{}};
  if(release>current[index]) return {...base,status:'unreachable',reason:'The requested reserve cannot be restored by reducing the affected market alone. Use a wider operations plan.',candidates:{}};
  const unaffected=[0,1,2].filter(n=>n!==index);
  const [first,second]=unaffected;
  const head1=max(cap(state,first)-current[first],0n);
  const head2=max(cap(state,second)-current[second],0n);
  const preferFirst=index===0;
  const possibilities=[];
  // Target enumeration is bounded by the on-chain fixed allocation capacity
  // (1,000 units in this demo). For large future policies, sample a bounded
  // prefix rather than pretending to exhaust an unbounded search space.
  const maxExtra=release-reserveGap;
  const possibleRetire=[];
  for(let r=reserveGap;r<=min(release,reserveGap+20n);r++) possibleRetire.push(r);
  for(const r of [release,(release+reserveGap)/2n]) if(!possibleRetire.some(v=>v===r)) possibleRetire.push(r);
  for(const retired of possibleRetire) {
    const redeployed=release-retired;
    const lo=max(0n,redeployed-head2);
    const hi=min(redeployed,head1);
    // Only enumerating allocations, never deciding final policy validity.
    for(let allocation1=lo;allocation1<=hi;allocation1++) {
      const allocation2=redeployed-allocation1;
      const target=[...current];
      target[index]-=release;target[first]+=allocation1;target[second]+=allocation2;
      possibilities.push({target,retired,allocation1,allocation2,
        moveCount:Number(allocation1>0n)+Number(allocation2>0n)+Number(retired>0n)});
      if(possibilities.length>=180000) break;
    }
    if(possibilities.length>=180000) break;
  }
  const byKey=new Map(possibilities.map(p=>[key(stringTarget(p.target)),p]));
  const all=[...byKey.values()];
  // A stable rank only decides which candidates to ASK Fe about first.
  const continuity=[...all].sort((a,b)=>Number(a.retired-b.retired)||a.moveCount-b.moveCount||
    (preferFirst?Number(b.allocation1-a.allocation1):Number(a.allocation1-b.allocation1)));
  const spread=[...all].filter(p=>p.allocation1>0n&&p.allocation2>0n).sort((a,b)=>Number(a.retired-b.retired)||
    Math.max(utilization(state,a.target,first),utilization(state,a.target,second))-
    Math.max(utilization(state,b.target,first),utilization(state,b.target,second)) ||
    a.moveCount-b.moveCount);
  const reserveTarget=[...current];reserveTarget[index]-=release;
  return {...base,status:'active',reason:`Reduce ${NAMES[index]} by at least ${release} units and maintain at least ${minimum} units unallocated.`,
    candidates:{continuity,spread,reserve:[{target:reserveTarget,retired:release,allocation1:0n,allocation2:0n,moveCount:1}]}};
}
function metrics(state,target,inc,index) {
  const allocations=Object.values(target).map(asBig);
  const before=stateValues(state);
  const reserve=asBig(state.budget)-sum(allocations);
  return {
    allocated:String(sum(allocations)),reserve:String(reserve),
    retired:String(sum(before)-sum(allocations)),
    incidentExposure:String(allocations[index]),
    roomBeforeLimit:String(asBig(inc.maximum)-allocations[index]),
    changes:allocations.map((v,i)=>({market:NAMES[i],from:String(before[i]),to:String(v),delta:String(v-before[i])})),
  };
}
export async function assessIncident({state,incident,role,previewActions,previewIncidentActions}) {
  if(typeof previewIncidentActions!=='function') throw Error('Fe incident attestation preview is required');
  const data=incidentCandidates(state,incident);
  const indexed=Number(incident.market);
  const base={incident,expectedVersion:String(state.version),role,
    current:data.current,currentReserve:data.currentReserve,
    currentExposure:data.current[['a','b','c'][indexed]],
    release:data.release,reason:data.reason,status:data.status};
  if(data.status!=='active') return {...base,options:[]};
  const options=[];const previouslySelected=new Set();
  for(const strategy of INCIDENT_STRATEGIES) {
    let selected=null,feRejected=null,evaluated=0;
    for(const proposal of data.candidates[strategy.id].slice(0,24)) {
      const target=stringTarget(proposal.target);
      if(previouslySelected.has(key(target)) && strategy.id!=='reserve') continue;
      const goal={kind:'target',...target};
      const plan=await planFromFe({state,goal,role,previewActions});evaluated+=plan.evaluated;
      if(plan.status==='ready'||plan.status==='unauthorized') {
        const incidentPreview=await previewIncidentActions({
          expectedVersion:BigInt(state.version),
          steps:plan.steps.map(step=>({opcode:BigInt(step.opcode),amount:BigInt(step.amount)})),
          target:plan.target,incident,role,
        });
        // Reject any divergence between the two independent Fe previews,
        // whether caused by an altered goal, operations, or incident limits.
        if(incidentPreview.mask!==0||incidentPreview.operationError!==0||
          incidentPreview.incidentMask!==0||!incidentPreview.goalMatches||
          ['a','b','c'].some(k=>incidentPreview.final[k]!==plan.target[k])||
          incidentPreview.authorized!==plan.preview.authorized) {
          feRejected={reason:`Fe incident attestation rejected this target (incident mask ${incidentPreview.incidentMask}, policy mask ${incidentPreview.mask}).`,
            preview:incidentPreview};
          continue;
        }
        selected={plan,proposal,incidentPreview};break;
      }
      if(plan.preview) feRejected=plan;
    }
    const basis={id:strategy.id,title:strategy.title,caption:strategy.caption,evaluated};
    if(!selected) {
      options.push({...basis,status:'infeasible',reason:feRejected?.reason||'No verified distinct plan found within the bounded three-operation search.',
        feMask:feRejected?.preview?.mask??null,operationError:feRejected?.preview?.operationError??null});
      continue;
    }
    const {plan,proposal,incidentPreview}=selected;
    if(['a','b','c'].some(k=>asBig(plan.target[k])<0n))throw Error('INCIDENT_NEGATIVE_FINAL');
    if(asBig(plan.target[['a','b','c'][indexed]])>asBig(incident.maximum)) throw Error('INCIDENT_EXPOSURE_GOAL_MISMATCH');
    const reserve=asBig(state.budget)-sum(Object.values(plan.target).map(asBig));
    if(reserve<asBig(incident.reserve)) throw Error('INCIDENT_RESERVE_GOAL_MISMATCH');
    const digest=responseFingerprint({incident,strategy:strategy.id,expectedVersion:state.version,plan});
    previouslySelected.add(key(plan.target));
    options.push({...basis,status:plan.status,target:plan.target,steps:plan.steps,
      stageMasks:plan.preview.stageMasks,feMask:plan.preview.mask,
      operationError:plan.preview.operationError,authorized:incidentPreview.authorized,
      feIncidentMask:incidentPreview.incidentMask,feIncidentGoalMatches:incidentPreview.goalMatches,
      feIncidentPreviewSource:incidentPreview.from,
      digest,goalFingerprint:plan.digest,reason:plan.reason,
      metrics:metrics(state,plan.target,incident,indexed)});
  }
  return {...base,status:options.some(o=>['ready','unauthorized'].includes(o.status))?'assessed':'infeasible',options};
}
