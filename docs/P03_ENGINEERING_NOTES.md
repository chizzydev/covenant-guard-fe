# P03-R1 engineering notes

- Source of truth: P02-R3 owner Fe result P02_GATE=PASS, Fe 26.5.0 SHA D86CA3...
- The Fe `Guarded` wrapper remains a private-state library. The owner/integrator is responsible for not replacing the whole wrapper and authenticating callers.
- Active contained phase=2 always requires final allocations <= stored exposure maximum, unallocated reserve >= required minimum, and permanent policy.
- Atomic activation uses the *same* `commit_goal`/`checked_edit` pipeline; receipt version increases exactly once, not twice.
- Release is guardian-adapter-only; release increments revision once and preserves incident historical id. No lock weakening methods exist for ordinary operators.
- `GuardianTestActor` is an intentionally unauthenticated **test fixture**. Its presence does not establish real-world authorization of the guardian address.
- P04 will introduce phase=1 and dimension-wise strictly decreasing deficit; do not treat P03 as supporting multi-tx recovery.
- Fe 26.5.0 projection semantics are the main compile/runtime risk and the owner gate is decisive.
- Inputs with invalid >1e6 allocations are rejected by permanent mask before incident additions; the incident predicate avoids arithmetic overflow for them.
- All tests are authored; until the owner runs them, these are test intentions, not passed evidence.
