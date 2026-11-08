// Additive P06 local endpoints, operating on real P05 Fe Guard3 contracts.
// Both contracts are compiled Fe EVM bytecode. The API never authoritatively
// evaluates policy masks, incident deficits, or recoverability in JavaScript.
export function createGuardApi({runtime,audit,serialized,serializedMutation,reply,jsonBody,parseUInt,host,port}) {
  function domainOf(value) {
    if (value !== 'allocation' && value !== 'governance') throw Error('GUARD_INVALID_DOMAIN');
    return value;
  }
  function roleOf(value) {
    if (!['admin','guardian','reviewer'].includes(value)) throw Error('GUARD_INVALID_ROLE');
    return value;
  }
  function numberOf(data, key) { return parseUInt(data[key], key); }
  function triple(data) {
    return {x:numberOf(data,'x'),y:numberOf(data,'y'),z:numberOf(data,'z')};
  }
  function protection(state) {
    return {
      version:state.version,x:state.x,y:state.y,z:state.z,
      incident:state.incident,deficits:state.deficits,
    };
  }
  async function transact(res,data,op) {
    const domain=domainOf(data.domain),role=roleOf(data.role);
    return serializedMutation(async()=>{
      const before=await runtime.state(domain);
      const tx=await op({domain,role});
      const after=await runtime.state(domain);
      if (!tx.success && JSON.stringify(protection(before))!==JSON.stringify(protection(after))) {
        throw Error('GUARD_REJECTED_TRANSACTION_MUTATED_PROTECTED_STATE');
      }
      if (tx.success && BigInt(after.version)!==BigInt(before.version)+1n) {
        throw Error('GUARD_ACCEPTED_TRANSACTION_VERSION_MISMATCH');
      }
      const entry=audit.append({
        kind:'transaction',operation:`guard_${tx.method}`,domain,role,
        outcome:tx.success?'committed':'rejected', sender:tx.sender,
        receipt:tx,txHash:tx.transactionHash,gasSpent:tx.gasSpent,evmException:tx.error,
        before:protection(before),after:protection(after),
        rejectionCategory:tx.success?null:'EVM_REVERT',
      });
      return reply(res,200,{result:tx,before,after,
        journal:{index:entry.index,digest:entry.digest},audit:audit.status()});
    });
  }
  return async function guardApi(req,res,pathname) {
    if (req.method==='GET' && pathname==='/api/guard/state') {
      return serialized(async()=>reply(res,200,{
        states:await runtime.bothStates(),runtime:runtime.details,
        audit:audit.status(),
      }));
    }
    if (req.method!=='POST') return reply(res,405,{error:'POST required'});
    const origin=req.headers.origin;
    if (origin && origin!==`http://${host}:${port}` && origin!==`http://localhost:${port}`) {
      return reply(res,403,{error:'Cross-origin modification blocked'});
    }
    const data=await jsonBody(req);
    if (pathname==='/api/guard/preview') {
      const domain=domainOf(data.domain),role=roleOf(data.role);
      const proposal=triple(data),expected=numberOf(data,'expectedVersion');
      return serialized(async()=>reply(res,200,{
        preview:await runtime.preview({domain,role,expected,...proposal}),
        current:await runtime.state(domain),
      }));
    }
    if (pathname==='/api/guard/commit') {
      const expected=numberOf(data,'expectedVersion'),value=triple(data);
      return transact(res,data,({domain,role})=>runtime.commit({domain,role,expected,...value}));
    }
    if (pathname==='/api/guard/migrate') {
      const expected=numberOf(data,'expectedVersion');
      const first=numberOf(data,'first'),second=numberOf(data,'second');
      const firstValue=numberOf(data,'firstValue'),secondValue=numberOf(data,'secondValue');
      return transact(res,data,({domain,role})=>runtime.migrate({
        domain,role,expected,first,second,firstValue,secondValue,
      }));
    }
    if (pathname==='/api/guard/activate') {
      const expected=numberOf(data,'expectedVersion');
      const mode=String(data.mode);
      if (!['atomic','progressive'].includes(mode)) throw Error('GUARD_INVALID_ACTIVATION_MODE');
      const market=numberOf(data,'market');
      const maximum=numberOf(data,'maximum');
      const bufferMinimum=numberOf(data,'bufferMinimum');
      if (market>2n) throw Error('GUARD_INVALID_INCIDENT_MARKET');
      const target=mode==='atomic'?triple(data):null;
      return transact(res,data,({domain,role})=>runtime.activate({
        domain,role,expected,mode,market,maximum,bufferMinimum,target,
      }));
    }
    if (pathname==='/api/guard/release') {
      const expected=numberOf(data,'expectedVersion');
      const incidentId=numberOf(data,'incidentId');
      return transact(res,data,({domain,role})=>runtime.release({
        domain,role,expected,incidentId,
      }));
    }
    return reply(res,404,{error:'GUARD_UNKNOWN_ENDPOINT'});
  };
}
