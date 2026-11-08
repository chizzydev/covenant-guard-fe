from pathlib import Path
import sys,json,itertools
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'p07/spec'))
from oracle import INITIAL,permanent,step,record
rows=[]
grid=list(itertools.product([0,100,200],repeat=3))
for values in grid:
 if not permanent(values):continue
 for mode in ['none','recovering','contained']:
  setup=[{'method':'commit','role':'admin','args':['1',*map(str,values)]}]
  s,_=step(INITIAL,setup[0])
  if mode!='none':
   cmd={'method':'activateProgressive','role':'guardian','args':[str(s.version),'0','0' if mode=='recovering' else '1000000','1000' if mode=='recovering' else '100']}
   setup.append(cmd);s,result=step(s,cmd);assert result['success']
  probes=[]
  for target in grid:
   cmd={'method':'commit','role':'admin','args':[str(s.version),*map(str,target)]}
   _,result=step(s,cmd);probes.append({'args':cmd['args'],'allowed':result['success']})
  rows.append({'initial':values,'mode':mode,'setup':setup,'expected':record(s),'probes':probes})
print(json.dumps(rows))
