"""Independent Covenant Guard protocol model (standard library only).

Source of truth: behavioral obligations in the master engineering RFC, NOT Fe
code, ABI generated artifacts, or application JavaScript. The driver below
translates selector arguments only; all acceptance is computed independently.
This is bounded test evidence, never a formal verification claim.
"""
from __future__ import annotations
from dataclasses import dataclass, replace
import json
from typing import Any

BUDGET=1000
MIN_RESERVE=100
CAPS=(550,500,350)
INPUT_CEILING=1_000_000
OPERATOR='admin'
GUARDIAN='guardian'

class Reject(ValueError):
    pass

def require(condition: bool, name: str):
    if not condition: raise Reject(name)

@dataclass(frozen=True)
class Incident:
    phase:int=0
    id:int=0
    market:int=0
    maximum:int=0
    buffer_min:int=0

@dataclass(frozen=True)
class State:
    version:int=1
    values:tuple[int,int,int]=(400,300,100)
    incident:Incident=Incident()

INITIAL=State()
WRITERS=('commit','commitMigration','commitActions','commitGoalActions',
         'commitIncidentActions','activateProgressive','activateContain','releaseIncidentBound')

def permanent(values:tuple[int,int,int])->bool:
    if len(values)!=3 or any(type(x)!=int or x<0 or x>INPUT_CEILING for x in values):return False
    x,y,z=values
    return sum(values)<=BUDGET-MIN_RESERVE and all(v<=cap for v,cap in zip(values,CAPS)) and x<=2*y

def deficits(s:State)->tuple[int,int]:
    i=s.incident
    if i.phase==0:return 0,0
    return max(0,s.values[i.market]-i.maximum),max(0,i.buffer_min-(BUDGET-sum(s.values)))

def valid_spec(market:int,maximum:int,buffer_min:int)->bool:
    return 0<=market<=2 and 0<=maximum<=INPUT_CEILING and MIN_RESERVE<=buffer_min<=BUDGET

def _checked(s:State,target:tuple[int,int,int])->State:
    require(permanent(target),'PERMANENT_POLICY')
    i=s.incident
    if i.phase:
        old=deficits(s)
        next_state=replace(s,values=target)
        new=deficits(next_state)
        if i.phase==1:
            require(new[0]<=old[0] and new[1]<=old[1],'NONWORSENING')
            require(new!=old,'STRICT_PROGRESS')
            if new==(0,0):i=replace(i,phase=2)
        else:
            require(new==(0,0),'CONTAINED_NONREGRESSION')
    return replace(s,values=target,version=s.version+1,incident=i)

def _ordered(values:tuple[int,int,int],n:int,ops:list[int])->tuple[int,int,int]:
    require(1<=n<=3,'ACTION_COUNT')
    v=list(values)
    for idx in range(n):
        op,amount=ops[idx*2:idx*2+2]
        require(0<=op<18 and 0<=amount<=INPUT_CEILING,'BAD_INSTRUCTION')
        if op<9:
            src,dst=divmod(op,3)
            require(src!=dst and amount>0,'SELF_OR_ZERO_MOVE')
            require(v[src]>=amount and v[dst]+amount<=INPUT_CEILING,'MOVE_CAPACITY')
            v[src]-=amount;v[dst]+=amount
        elif op<12:
            src=op-9
            require(amount>0 and v[src]>=amount,'RETIRE_CAPACITY')
            v[src]-=amount
        elif op<15:
            dst=op-12
            require(amount>0 and v[dst]+amount<=INPUT_CEILING,'ISSUE_CEILING')
            require(sum(v)+amount<=BUDGET,'ISSUE_CAPACITY')
            v[dst]+=amount
        else:
            require(v[op-15]==amount,'EXPECT_MISMATCH')
    return tuple(v)

def _migration(values:tuple[int,int,int],n:int,ops:list[int])->tuple[int,int,int]:
    require(1<=n<=3,'MIGRATION_COUNT')
    v=list(values)
    for idx in range(n):
        m,val=ops[idx*2:idx*2+2]
        require(0<=m<=2 and 0<=val<=INPUT_CEILING,'BAD_MIGRATION')
        v[m]=val
    return tuple(v)

def apply(s:State,step:dict[str,Any])->State:
    """Returns a new state or raises Reject; exceptions never alter the input."""
    name=step['method'];role=step['role'];a=tuple(int(x) for x in step['args'])
    require(name in WRITERS,'UNEXPECTED_MUTATOR')
    require(role==(GUARDIAN if name in WRITERS[5:] else OPERATOR),'WRONG_ACTOR')
    require(len(a)>0 and a[0]==s.version,'STALE_VERSION')
    if name=='commit':
        require(len(a)==4,'ARITY')
        return _checked(s,tuple(a[1:4]))
    if name=='commitMigration':
        require(len(a)==8,'ARITY')
        return _checked(s,_migration(s.values,a[1],list(a[2:8])))
    if name in ('commitActions','commitGoalActions','commitIncidentActions'):
        require(len(a)=={'commitActions':8,'commitGoalActions':11,'commitIncidentActions':14}[name],'ARITY')
        target=_ordered(s.values,a[1],list(a[2:8]))
        if name!='commitActions':require(target==tuple(a[8:11]),'GOAL_MISMATCH')
        if name=='commitIncidentActions':
            i=s.incident
            require(i.phase>0,'NO_ACTIVE_INCIDENT')
            require((i.market,i.maximum,i.buffer_min)==tuple(a[11:14]),'STORED_INCIDENT_MISMATCH')
        return _checked(s,target)
    if name=='activateProgressive':
        require(len(a)==4,'ARITY')
        market,maximum,buff=a[1:4]
        require(s.incident.phase==0 and valid_spec(market,maximum,buff),'BAD_ACTIVATION')
        i=Incident(phase=1,id=s.incident.id+1,market=market,maximum=maximum,buffer_min=buff)
        out=replace(s,incident=i,version=s.version+1)
        if deficits(out)==(0,0):out=replace(out,incident=replace(out.incident,phase=2))
        return out
    if name=='activateContain':
        require(len(a)==14,'ARITY')
        market,maximum,buff=a[1:4]
        require(s.incident.phase==0 and valid_spec(market,maximum,buff),'BAD_ACTIVATION')
        candidate=_ordered(s.values,a[4],list(a[5:11]))
        require(candidate==tuple(a[11:14]),'GOAL_MISMATCH')
        target_state=replace(s,incident=Incident(phase=2,id=s.incident.id+1,
            market=market,maximum=maximum,buffer_min=buff))
        return _checked(target_state,candidate)
    if name=='releaseIncidentBound':
        require(len(a)==2,'ARITY')
        i=s.incident
        require(i.phase==2 and a[1]==i.id and deficits(s)==(0,0),'RELEASE_DENIED')
        return replace(s,version=s.version+1,incident=replace(i,phase=0))
    raise AssertionError(name)

def record(s:State)->dict[str,Any]:
    i=s.incident
    return {'version':str(s.version),'values':[str(v) for v in s.values],
            'incident':{'phase':str(i.phase),'id':str(i.id),'market':str(i.market),
                'maximum':str(i.maximum),'bufferMinimum':str(i.buffer_min)},
            'deficits':[str(d) for d in deficits(s)]}

def step(s:State,command:dict[str,Any])->tuple[State,dict[str,Any]]:
    try:
        nxt=apply(s,command)
        return nxt,{'success':True,'state':record(nxt)}
    except Reject as error:
        return s,{'success':False,'state':record(s),'reason':str(error)}

def protocol()->dict[str,Any]:
    return {'writerNames':list(WRITERS),'roles':['admin','guardian','reviewer'],
            'phases':[0,1,2],'inputCeiling':INPUT_CEILING,
            'policy':{'budget':BUDGET,'reserveFloor':MIN_RESERVE,'caps':list(CAPS),'ratio':2}}

if __name__=='__main__':
    import sys
    command=json.load(sys.stdin)
    if command.get('fn')=='protocol':
        json.dump(protocol(),sys.stdout)
    elif command.get('fn')=='replay':
        s=INITIAL
        results=[]
        for instruction in command['steps']:
            s,result=step(s,instruction)
            results.append(result)
        json.dump({'initial':record(INITIAL),'results':results,'final':record(s)},sys.stdout)
    else:raise SystemExit('BAD_BRIDGE_REQUEST')
