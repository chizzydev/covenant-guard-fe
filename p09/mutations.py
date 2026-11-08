from pathlib import Path
import json,shutil
root=Path(__file__).resolve().parent.parent
cases={
 'incident_id':('assert!(expected == self.revision && incident_id == self.incident.id)','assert!(expected == self.revision)'),
 'exposure_dimension':('if next.0 > old.0 || next.1 > old.1 { return 128 }','if next.1 > old.1 { return 128 }'),
 'buffer_dimension':('if next.0 > old.0 || next.1 > old.1 { return 128 }','if next.0 > old.0 { return 128 }'),
}
records=[]
for name,(old,new) in cases.items():
 d=root/'results/p09/mutants'/name
 for rel in ['library/covenant_transition/src/lib.fe','library/covenant_transition/fe.toml','consumers/allocation_flagship/src/lib.fe','consumers/allocation_flagship/fe.toml']:
  dest=d/rel;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(root/rel,dest)
 p=d/'library/covenant_transition/src/lib.fe';s=p.read_text(encoding='utf-8');assert s.count(old)==1
 p.write_text(s.replace(old,new),encoding='utf-8',newline='\n')
 records.append({'name':name,'project':str(d/'consumers/allocation_flagship'),'artifactPrefix':str(d/'artifacts/AllocationFlagship')})
(root/'results/p09/extra-mutants.json').write_text(json.dumps(records,indent=2),encoding='utf-8')
print('P09_EXTRA_MUTANTS_PREPARED=3')
