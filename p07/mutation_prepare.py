"""Generate eight isolated, intentionally UNSAFE Fe compiler mutants.

No protected production source is changed. All mutants are created under
results/p07/mutants and must compile before they can be counted as detected.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT/'results'/'p07'/'mutants'
LIBRARY = 'library/covenant_transition/src/lib.fe'
FLAGSHIP = 'consumers/allocation_flagship/src/lib.fe'

CASES = {
    'authority': (FLAGSHIP,
        'Commit {expected_version,a,b,c} -> u256 uses (operator,ctx,mut engine) {\n            assert!(ctx.caller() == operator)',
        'Commit {expected_version,a,b,c} -> u256 uses (operator,ctx,mut engine) {\n            assert!(true)'),
    'revision': (LIBRARY,
        'pub fn checked_edit(mut self,_ expected:u256) -> mut TripleDraft {\n        assert!(expected == self.revision)',
        'pub fn checked_edit(mut self,_ expected:u256) -> mut TripleDraft {\n        assert!(true)'),
    'incident_boundary': (LIBRARY,
        'assert!(triple_transition_mask(before,candidate,self.rules,self.incident) == 0)',
        'assert!(true)'),
    'phase_finalization': (LIBRARY,
        'let remaining = triple_deficits(candidate,self.rules,self.incident)\n            if remaining.0 == 0 && remaining.1 == 0 {\n                self.incident.phase = 2',
        'let remaining = triple_deficits(candidate,self.rules,self.incident)\n            if remaining.0 == 0 && remaining.1 == 0 {\n                self.incident.phase = 1'),
    'permanent_policy': (LIBRARY,
        'assert!(triple_permanent_mask(candidate,self.rules) == 0)',
        'assert!(true)'),
    'exact_goal': (LIBRARY,
        'assert!(draft.x == target_x && draft.y == target_y && draft.z == target_z)',
        'assert!(true)'),
    'guardian_release': (FLAGSHIP,
        'ReleaseIncidentBound {expected_version,incident_id} -> u256\n            uses (guardian,ctx,mut engine) {\n            assert!(ctx.caller() == guardian)',
        'ReleaseIncidentBound {expected_version,incident_id} -> u256\n            uses (guardian,ctx,mut engine) {\n            assert!(true)'),
    'self_move': (LIBRARY,
        'if from == to { return 3 }\n        let old_from = triple_at(draft,from)',
        'if false { return 3 }\n        let old_from = triple_at(draft,from)'),
}

def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    manifest=[]
    for name, (target, old, new) in CASES.items():
        location=OUTPUT/name
        if location.exists():
            shutil.rmtree(location)
        (location/'library'/'covenant_transition'/'src').mkdir(parents=True)
        (location/'consumers'/'allocation_flagship'/'src').mkdir(parents=True)
        for rel in (LIBRARY,FLAGSHIP,
                    'library/covenant_transition/fe.toml',
                    'consumers/allocation_flagship/fe.toml'):
            dest=location/rel
            dest.parent.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(ROOT/rel,dest)
        source=location/target
        content=source.read_text(encoding='utf-8')
        if content.count(old)!=1:
            raise RuntimeError(f'INVALID_MUTATION_ANCHOR={name}, count={content.count(old)}')
        source.write_text(content.replace(old,new,1),encoding='utf-8',newline='\n')
        # Ensure the other file remains exactly the owner-verified P06 source.
        other=FLAGSHIP if target==LIBRARY else LIBRARY
        if sha(location/other)!=sha(ROOT/other):
            raise RuntimeError(f'MUTANT_NON_TARGET_DRIFT={name}')
        manifest.append({'name':name,'changedFile':target,'mutatedSha256':sha(source),
          'originalSha256':sha(ROOT/target),
          'project':str((location/'consumers'/'allocation_flagship').resolve()),
          'artifactPrefix':str((location/'artifacts'/'AllocationFlagship').resolve())})
    (ROOT/'results'/'p07'/'mutation-manifest.json').write_text(json.dumps({'schema':'P07_COMPILER_MUTANTS_V1','mutants':manifest},indent=2),encoding='utf-8')
    print('P07_MUTANTS_PREPARED='+str(len(manifest)))
    print('P07_MUTANTS_ARE_ISOLATED=YES')

if __name__=='__main__':main()
