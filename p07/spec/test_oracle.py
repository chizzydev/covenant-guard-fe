import unittest
from dataclasses import replace
from oracle import INITIAL,Incident,State,Reject,apply,step,deficits,permanent,WRITERS,record
from traces import cmd,ops,migration,stable_prefix,random_trace,witness

class OracleTests(unittest.TestCase):
    def test_initial_invariant(self):self.assertTrue(permanent(INITIAL.values))
    def test_mutator_inventory(self):self.assertEqual(len(WRITERS),8)
    def test_unauthorized(self):
        for role in ('guardian','reviewer'):
            before,result=step(INITIAL,cmd('commit',role,1,350,350,100))
            self.assertFalse(result['success']);self.assertEqual(before,INITIAL)
    def test_stale(self):
        before,result=step(INITIAL,cmd('commit','admin',0,350,350,100))
        self.assertFalse(result['success']);self.assertEqual(before,INITIAL)
    def test_unsafe_goal_atomic(self):
        before,result=step(INITIAL,cmd('commitGoalActions','admin',1,*ops((9,100)),350,300,100))
        self.assertFalse(result['success']);self.assertEqual(before,INITIAL)
    def test_progressive_monotone(self):
        started=apply(INITIAL,cmd('activateProgressive','guardian',1,0,200,300))
        self.assertEqual(deficits(started),(200,100))
        first=apply(started,cmd('commitActions','admin',2,*ops((9,100))))
        self.assertEqual(deficits(first),(100,0))
        self.assertEqual(first.incident.phase,1)
        done=apply(first,cmd('commitActions','admin',3,*ops((9,100))))
        self.assertEqual(deficits(done),(0,0))
        self.assertEqual(done.incident.phase,2)
    def test_noop_rejected_recovering(self):
        started=apply(INITIAL,cmd('activateProgressive','guardian',1,0,200,300))
        _,result=step(started,cmd('commitActions','admin',2,*ops((15,400))))
        self.assertFalse(result['success']);self.assertEqual(result['reason'],'STRICT_PROGRESS')
    def test_exposure_worsening_rejected(self):
        started=apply(INITIAL,cmd('activateProgressive','guardian',1,0,200,300))
        _,result=step(started,cmd('commit','admin',2,450,300,50))
        self.assertFalse(result['success']);self.assertEqual(result['reason'],'NONWORSENING')
    def test_issue_capacity_order(self):
        _,result=step(INITIAL,cmd('commitActions','admin',1,*ops((14,250),(9,250))))
        self.assertFalse(result['success'])
        out=apply(INITIAL,cmd('commitActions','admin',1,*ops((9,250),(14,250))))
        self.assertEqual(out.values,(150,300,350))
    def test_atomic(self):
        out=apply(INITIAL,cmd('activateContain','guardian',1,0,200,300,*ops((9,200)),200,300,100))
        self.assertEqual(out.incident.phase,2);self.assertEqual(out.version,2)
        self.assertEqual(out.values,(200,300,100))
    def test_release_id_bound(self):
        out=apply(INITIAL,cmd('activateContain','guardian',1,0,200,300,*ops((9,200)),200,300,100))
        _,result=step(out,cmd('releaseIncidentBound','guardian',2,2))
        self.assertFalse(result['success'])
        final=apply(out,cmd('releaseIncidentBound','guardian',2,1))
        self.assertEqual(final.incident.id,1);self.assertEqual(final.incident.phase,0)
    def test_prefix_mixed_accept_reject(self):
        seq,s=stable_prefix();w=witness(seq)
        self.assertEqual(len(seq),24)
        self.assertGreaterEqual(w['accepts'],8)
        self.assertGreaterEqual(w['rejects'],8)
        self.assertEqual(w['final'],record(s))
    def test_seed_reproducible(self):
        a,_=random_trace(1717,95);b,_=random_trace(1717,95)
        self.assertEqual(a,b)
        self.assertNotEqual(a,random_trace(1718,95)[0])
    def test_bounded_exhaustive_direct(self):
        for a in (0,100,200,300,400,550):
            for b in (0,100,200,300,450,500):
                for c in (0,100,200,350):
                    target=(a,b,c)
                    next_state,result=step(INITIAL,cmd('commit','admin',1,*target))
                    self.assertEqual(result['success'],permanent(target))
                    if not result['success']:self.assertEqual(next_state,INITIAL)
    def test_role_selector_phase_exhaustive_offchain(self):
        for phase in (0,1,2):
            base=INITIAL
            if phase:base=apply(base,cmd('activateProgressive','guardian',1,0,200 if phase==1 else 500,300 if phase==1 else 100))
            for role in ('admin','guardian','reviewer'):
                for name in WRITERS:
                    if name=='commit':args=[base.version,*base.values]
                    elif name=='commitMigration':args=[base.version,*migration((0,base.values[0]))]
                    elif name=='commitActions':args=[base.version,*ops((15,base.values[0]))]
                    elif name in ('commitGoalActions','commitIncidentActions'):
                        args=[base.version,*ops((15,base.values[0])),*base.values]
                        if name=='commitIncidentActions':args += [base.incident.market,base.incident.maximum,base.incident.buffer_min]
                    elif name=='activateProgressive':args=[base.version,0,200,300]
                    elif name=='activateContain':args=[base.version,0,200,300,*ops((9,200)),200,base.values[1],base.values[2]]
                    else:args=[base.version,base.incident.id]
                    observed,result=step(base,cmd(name,role,*args))
                    if role!=('guardian' if name in WRITERS[5:] else 'admin'):
                        self.assertFalse(result['success'],(phase,role,name))
                        self.assertEqual(observed,base)

if __name__=='__main__':unittest.main()
