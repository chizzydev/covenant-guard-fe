"""Exhaustive 3-phase x 3-actor x 8-public-mutator test catalog."""
import json
from oracle import INITIAL,WRITERS,step,record
from traces import cmd,preset

def catalog():
    entries=[]
    for phase in (0,1,2):
        setup=[]
        s=INITIAL
        if phase:
            setup=[cmd('activateProgressive','guardian',1,0,200 if phase==1 else 500,300 if phase==1 else 100)]
            s,_=step(s,setup[0])
            assert s.incident.phase==phase
        for role in ('admin','guardian','reviewer'):
            for method in WRITERS:
                command=preset(s,method,role)
                _,expect=step(s,command)
                entries.append({'phase':phase,'role':role,'method':method,
                    'setup':setup,'command':command,'before':record(s),'expected':expect})
    assert len(entries)==72
    return entries
if __name__=='__main__':
    print(json.dumps({'schema':'P07_MATRIX_V1','entries':catalog()},separators=(',',':')))
