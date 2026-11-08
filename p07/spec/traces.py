"""Deterministic black-box instructions for Fe replay; independent Python oracle."""
from __future__ import annotations
from random import Random
from dataclasses import dataclass
from oracle import INITIAL, State, record, step, protocol, permanent, deficits
import argparse,json

def cmd(method, role, *args):
    return {'method':method,'role':role,'args':[str(v) for v in args]}

def ops(*items):
    flat=[]
    for op,qty in items:flat.extend([op,qty])
    return [len(items)]+(flat+[0]*6)[:6]

def migration(*items):
    return ops(*items)

def preset(s:State, name:str, role:str='admin', stale=False):
    v=s.version-(1 if stale else 0)
    x,y,z=s.values
    if name=='commit':
        if s.incident.phase==1:target=(max(0,x-50),y,z)
        elif s.incident.phase==2:target=(x,y,z)
        else:target=(max(0,x-50),y+50,z)
        return cmd('commit',role,v,*target)
    if name=='commitMigration':
        return cmd('commitMigration',role,v,*migration((0,max(0,x-50))))
    if name=='commitActions':
        return cmd('commitActions',role,v,*ops((9,50 if x>=50 else 1)))
    if name=='commitGoalActions':
        amount=50 if x>=50 else 1
        return cmd('commitGoalActions',role,v,*ops((9,amount)),x-amount,y,z)
    if name=='commitIncidentActions':
        amount=50 if x>=50 else 1
        i=s.incident
        return cmd('commitIncidentActions',role,v,*ops((9,amount)),x-amount,y,z,
                   i.market,i.maximum,i.buffer_min)
    if name=='activateProgressive':
        return cmd(name,role,v,0,200,300)
    if name=='activateContain':
        amount=x-200
        return cmd(name,role,v,0,200,300,*ops((9,amount)),200,y,z)
    if name=='releaseIncidentBound':
        return cmd(name,role,v,s.incident.id)
    raise ValueError(name)

def stable_prefix():
    """Scripted all-protocol lifecycle with positive and negative evidence."""
    s=INITIAL
    sequence=[]
    def add(method,role,*args):
        nonlocal s
        c=cmd(method,role,*args)
        s,_=step(s,c)
        sequence.append(c)
    add('commit','reviewer',1,350,350,100)              # unauthorized
    add('commit','admin',0,350,350,100)                 # stale
    add('commit','admin',s.version,350,350,100)         # success
    add('commitGoalActions','admin',s.version,*ops((9,50)),310,350,100) # wrong goal
    add('commitMigration','admin',s.version,*migration((0,400),(1,300))) # restore
    add('activateProgressive','admin',s.version,0,200,300) # not guardian
    add('activateProgressive','guardian',s.version,0,200,300) # start recovery
    add('activateProgressive','guardian',s.version,0,200,300) # already active
    add('commitActions','reviewer',s.version,*ops((9,100)))
    add('commit','admin',s.version,*s.values)             # no progress
    add('commit','admin',s.version,450,300,50)            # exposure worsening
    add('commitActions','admin',s.version,*ops((9,100)))  # valid progress
    add('commitMigration','admin',s.version,*migration((0,350))) # regression
    add('commitActions','admin',s.version,*ops((15,300))) # no-op expect
    add('commitGoalActions','admin',s.version,*ops((9,100)),200,300,100) # contained
    add('commit','admin',s.version,250,300,100)          # contained regression
    add('releaseIncidentBound','guardian',s.version,99) # wrong incident id
    add('releaseIncidentBound','admin',s.version,s.incident.id) # wrong caller
    add('releaseIncidentBound','guardian',s.version,s.incident.id) # release
    add('commit','admin',s.version,400,300,100)          # restore baseline
    add('activateContain','guardian',s.version,0,200,300,*ops((9,200)),200,300,100)
    add('commitIncidentActions','admin',s.version,*ops((15,200)),200,300,100,0,300,300) # mismatched stored
    add('commitActions','admin',s.version,*ops((15,200))) # contained no-op may succeed
    add('releaseIncidentBound','guardian',s.version,s.incident.id) # release
    return sequence,s

def random_trace(seed:int,count:int):
    require_count=count>=25
    if not require_count:raise ValueError('count needs >=25')
    rng=Random(seed)
    commands,s=stable_prefix()
    while len(commands)<count:
        x,y,z=s.values
        i=s.incident
        role=rng.choices(['admin','guardian','reviewer'],weights=[7,2,2])[0]
        stale=rng.random()<0.18
        v=s.version-(1 if stale else 0)
        kind=rng.randrange(11)
        if kind==0: cand=cmd('commit',role,v,x,y,z)
        elif kind==1:
            target=tuple([max(0,x-rng.choice([0,25,50,100])),y,z])
            cand=cmd('commit',role,v,*target)
        elif kind==2:
            target=(min(600,x+rng.choice([0,25,50,100])),y,z)
            cand=cmd('commit',role,v,*target)
        elif kind==3:
            cand=cmd('commitMigration',role,v,*migration((rng.randrange(3),rng.choice([0,100,200,300,350,400,500,550]))))
        elif kind==4:
            op=rng.randrange(18)
            qty=rng.choice([0,1,25,50,100,200,x,y,z])
            cand=cmd('commitActions',role,v,*ops((op,qty)))
        elif kind==5:
            amt=min(x,rng.choice([0,25,50,100]))
            cand=cmd('commitGoalActions',role,v,*ops((9,amt)),x-amt,y,z)
        elif kind==6:
            amt=min(x,rng.choice([0,25,50,100]))
            inc=i
            cand=cmd('commitIncidentActions',role,v,*ops((9,amt)),x-amt,y,z,inc.market,inc.maximum,inc.buffer_min)
        elif kind==7:cand=cmd('activateProgressive',role,v,0,rng.choice([150,200,300,450,550]),rng.choice([100,200,300]))
        elif kind==8:
            amount=x-200 if x>=200 else 0
            cand=cmd('activateContain',role,v,0,200,300,*ops((9,amount)),200,y,z)
        elif kind==9:cand=cmd('releaseIncidentBound',role,v,rng.choice([i.id,i.id+1]))
        else:
            m1=rng.randrange(3);m2=rng.randrange(3)
            cand=cmd('commitMigration',role,v,*migration((m1,rng.choice([100,200,300])),(m2,rng.choice([100,300,400]))))
        s,_=step(s,cand)
        commands.append(cand)
    return commands,s

def witness(commands):
    s=INITIAL
    output=[]
    for n,c in enumerate(commands):
        s,expected=step(s,c)
        output.append({'ordinal':n,'command':c,'expected':expected})
    return {'schema':'COVENANT_GUARD_P07_ORACLE_V1','protocol':protocol(),
            'initial':record(INITIAL),'steps':output,'final':record(s),
            'accepts':sum(int(item['expected']['success']) for item in output),
            'rejects':sum(int(not item['expected']['success']) for item in output)}

if __name__=='__main__':
    ap=argparse.ArgumentParser()
    ap.add_argument('--seed',type=int,default=701)
    ap.add_argument('--count',type=int,default=90)
    args=ap.parse_args()
    commands,_=random_trace(args.seed,args.count)
    print(json.dumps({'seed':args.seed,**witness(commands)},separators=(',',':')))
