"""Batch independent Python predictions for static-only finite-domain tests."""
import json,sys
from oracle import INITIAL,apply,step
from traces import cmd
request=json.load(sys.stdin)
phase=request['phase']
s=INITIAL
if phase:
    s=apply(s,cmd('activateProgressive','guardian',1,0,200 if phase==1 else 500,300 if phase==1 else 100))
allowed=[]
for c in request['requests']:
    _,result=step(s,c)
    allowed.append(result['success'])
json.dump({'accepts':allowed},sys.stdout)
