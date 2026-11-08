import test from 'node:test';
import assert from 'node:assert/strict';
import { assessIncident, incidentCandidates, responseFingerprint } from '../lib/incident.mjs';

const initial={version:'1',a:'400',b:'300',c:'100',budget:'1000',reserveFloor:'100',
  capA:'550',capB:'500',capC:'350',inputCeiling:'1000000',pairedMultiplier:'2'};
const coreIncident={market:'0',maximum:'200',reserve:'200'};

// Deliberately small test-double interpreter for the Fe wire format.
// Production incident plans always run actual Fe previewActions(), never this mock.
function mockFe(state,{steps,role}) {
  const values=[BigInt(state.a),BigInt(state.b),BigInt(state.c)];
  const budget=BigInt(state.budget);
  let error=0;
  for(const [i,step] of steps.entries()) {
    const op=Number(step.opcode),amount=BigInt(step.amount);
    if(op<9){
      const from=Math.floor(op/3),to=op%3;
      if(from===to||amount>values[from]){error=(i+1)*16+4;break;}
      values[from]-=amount;values[to]+=amount;
    }else if(op<12){
      const from=op-9;
      if(values[from]<amount){error=(i+1)*16+4;break;}
      values[from]-=amount;
    }else if(op<15){
      if(budget-values.reduce((a,b)=>a+b,0n)<amount){error=(i+1)*16+5;break;}
      values[op-12]+=amount;
    }else if(op<18){if(values[op-15]!==amount){error=(i+1)*16+6;break;}}
  }
  const total=values.reduce((a,b)=>a+b,0n);
  let mask=0;
  if(total>budget)mask|=1;
  if(values.some((v,i)=>v>BigInt(state[`cap${'ABC'[i]}`])))mask|=2;
  if(total+BigInt(state.reserveFloor)>budget)mask|=4;
  if(values[0]>2n*values[1])mask|=8;
  if(error)mask|=64;
  return {mask,operationError:error,authorized:role==='admin',
    final:{a:String(values[0]),b:String(values[1]),c:String(values[2])},
    stageMasks:steps.map((_,i)=>i===steps.length-1?mask:0)};
}

const previewActions=({steps,role})=>Promise.resolve(mockFe(initial,{steps,role}));
// Mock is for offline incident-planner unit tests ONLY. The HTTP and runtime
// tests call actual compiled Fe previewIncidentActions() via EthereumJS.
const previewIncidentActions=({steps,role,incident,target})=>{
  const p=mockFe(initial,{steps,role});
  const market=Number(incident.market),maximum=BigInt(incident.maximum),reserve=BigInt(incident.reserve);
  const final=[BigInt(p.final.a),BigInt(p.final.b),BigInt(p.final.c)];
  let incidentMask=0;
  if(market<0||market>2||maximum>1000000n||reserve<100n||reserve>1000n) incidentMask=4;
  else {
    if(final[market]>maximum) incidentMask|=1;
    if(1000n-final.reduce((a,b)=>a+b,0n)<reserve) incidentMask|=2;
  }
  return Promise.resolve({...p,incidentMask,goalMatches:p.final.a===target.a&&p.final.b===target.b&&p.final.c===target.c,
    from:'mock Fe incident preview unit test'});
};

test('incident candidate generator responds to the actual Fe state and compares reserve tradeoffs',()=>{
  const r=incidentCandidates(initial,coreIncident);
  assert.equal(r.status,'active');
  assert.equal(r.release,'200');
  assert.equal(r.currentReserve,'200');
  assert.ok(r.candidates.continuity.length>0);
  assert.ok(r.candidates.spread.some(p=>p.allocation1>0n&&p.allocation2>0n));
  assert.deepEqual(r.candidates.reserve[0].target.map(String),['200','300','100']);
});

test('incident Fe responses distinguish continuity, dispersion, and additional reserves',async()=>{
  const assessed=await assessIncident({state:initial,incident:coreIncident,role:'admin',previewActions,previewIncidentActions});
  assert.equal(assessed.status,'assessed');
  assert.equal(assessed.options.length,3);
  for(const opt of assessed.options){
    assert.equal(opt.status,'ready',`${opt.id}: ${opt.reason}`);
    assert.equal(opt.feMask,0);
    assert.match(opt.digest,/^[0-9a-f]{64}$/);
    assert.equal(opt.target.a,'200');
  }
  const byId=Object.fromEntries(assessed.options.map(o=>[o.id,o]));
  assert.deepEqual(byId.continuity.target,{a:'200',b:'500',c:'100'});
  assert.deepEqual(byId.reserve.target,{a:'200',b:'300',c:'100'});
  assert.equal(byId.reserve.metrics.reserve,'400');
  assert.equal(byId.continuity.metrics.reserve,'200');
  assert.notDeepEqual(byId.spread.target,byId.continuity.target);
  assert.notDeepEqual(byId.spread.target,byId.reserve.target);
  assert.equal(byId.spread.steps.length,2);
});

test('incident request recalculates from a changed state and recognizes containment',async()=>{
  const state={...initial,version:'2',a:'200',b:'500',c:'100'};
  const contained=await assessIncident({state,incident:coreIncident,role:'admin',previewActions:async()=>{throw Error('No Fe preview necessary');},previewIncidentActions});
  assert.equal(contained.status,'already_contained');
  assert.equal(contained.options.length,0);
  const next=incidentCandidates(state,{...coreIncident,maximum:'150'});
  assert.equal(next.status,'active');
  assert.equal(next.release,'50');
  assert.deepEqual(next.candidates.reserve[0].target.map(String),['150','500','100']);
});

test('incident demand can be impossible without pretending Fe approved it',async()=>{
  const demand=await assessIncident({state:initial,incident:{...coreIncident,reserve:'950'},role:'admin',previewActions:async()=>{throw Error('Should not call Fe');},previewIncidentActions});
  assert.equal(demand.status,'unreachable');
  assert.match(demand.reason,/affected market alone/);
  assert.equal(demand.options.length,0);
});

test('incident Fe rejection is authoritative and reviewer cannot submit feasible goals',async()=>{
  const reviewer=await assessIncident({state:initial,incident:coreIncident,role:'reviewer',previewActions,previewIncidentActions});
  assert.equal(reviewer.status,'assessed');
  assert.equal(reviewer.options.every(x=>x.status!=='ready'),true);
  assert.equal(reviewer.options.some(x=>x.status==='unauthorized'),true);
  const denied=await assessIncident({state:initial,incident:coreIncident,role:'admin',previewIncidentActions,previewActions:async({steps})=>{
    const result=mockFe(initial,{steps,role:'admin'});
    return {...result,mask:2};
  }});
  assert.equal(denied.status,'infeasible');
  assert.equal(denied.options.every(x=>x.status==='infeasible'),true);
});

test('fingerprint changes with scenario, strategy, version and exact plan',async()=>{
  const ready=(await assessIncident({state:initial,incident:coreIncident,role:'admin',previewActions,previewIncidentActions})).options[0];
  const plan={digest:ready.goalFingerprint,target:ready.target,steps:ready.steps};
  const base={incident:coreIncident,strategy:'continuity',expectedVersion:'1',plan};
  assert.equal(responseFingerprint(base),ready.digest);
  assert.notEqual(responseFingerprint({...base,incident:{...coreIncident,reserve:'300'}}),ready.digest);
  assert.notEqual(responseFingerprint({...base,strategy:'reserve'}),ready.digest);
  assert.notEqual(responseFingerprint({...base,expectedVersion:'2'}),ready.digest);
  assert.notEqual(responseFingerprint({...base,plan:{...plan,steps:[{opcode:'9',amount:'200'}]}}),ready.digest);
});


test('planner cannot promote ordinary Fe permission into incident approval when Fe incident mask rejects',async()=>{
  let checked=0;
  const assessed=await assessIncident({state:initial,incident:coreIncident,role:'admin',previewActions,
    previewIncidentActions:async args=>{
      checked++;
      const p=await previewIncidentActions(args);
      return {...p,incidentMask:1};
    }});
  assert.ok(checked>0,'incident-specific Fe check was invoked');
  assert.equal(assessed.status,'infeasible');
  assert.ok(assessed.options.every(x=>x.status==='infeasible'));
});

test('wrong terminal target or incident goal cannot override the two-Fe-preview requirement',async()=>{
  const altered=await assessIncident({state:initial,incident:coreIncident,role:'admin',previewActions,
    previewIncidentActions:async args=>({...await previewIncidentActions(args),goalMatches:false})});
  assert.equal(altered.status,'infeasible');
  assert.ok(altered.options.every(x=>x.status==='infeasible'));
});
