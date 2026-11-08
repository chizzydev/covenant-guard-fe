# Continuity — resume from P06-R1 without drifting

## Owner-confirmed milestones (source: owner's stdout in previous turns)

- P01-R1: cross-ingot library, privacy, invalid final states and access conflict PASS; whole-wrapper replacement is an integrator trust boundary.
- P02-R3: 16 Fe tests PASS, authoritative allocation transition kernel, 13 consumer tests.
- P03-R1: 29 Fe tests PASS, persistent guardian incident constraints, atomic activation and all legacy mutators protected.
- P04-R2: 45 Fe tests PASS, progressive deficit-vector nonworsening, contained nonregression, exact guardian release.
- P05-R1: 56 Fe tests PASS (11 ingot +37 P04 regression +4 allocation pilot +4 governance), ABI builds PASS, generic Guard3 reused by two different Fe consumers.

## Current package

**P06-R1 candidate:** this new ZIP integrates P05 Guard3 contracts into the original v1.8 localhost application through actual EthereumJS deploy + signed transactions, a new `/guard.html` interface and six API routes, while still compiling and testing the original v1.8 contract and preserving seven existing views. It has NOT been executed with Fe/npm by the assistant environment. Run the owner PowerShell runner and repair any exact failures before making PASS claims.

**Deliberate nonunification:** two different localhost VM instances: (1) baseline seven-view Covenant Control contract v1.8, (2) shared Guard3 VM holding AllocationPilot+GovernanceRegistry. This is not a completed flagship generic cutover. Do not leave P06 marked fully complete based only on R1. Final R2/R3 should unify to one authoritative guarded flagship state once Guard3 gains the P04 ordered-operation/goal methods.

## Next corrective cycle

1. Owner runs P06-R1 full `RUN_WINDOWS.ps1` under new extracted folder, returns `results/P06_RUN_LOG.txt`.
2. Fix compiler/constructor/ABI/npm/test issues precisely; preserve passed P05 source hash and all P04/regression tests.
3. Once R1 vertical slice owner-PASS, add generic operation/goal API and integrate the original planner+incident desk into the single guarded contract, not a second isolated state.
4. P07 model differential, adversarial/actor matrix, mutation tests, rollback proofs; P08 CI/fresh clone/demo; P09 Codex review and submission. Protect Nov 17 registration, Nov 24 final UTC deadline.

## Working relationship

ChatGPT writes real files and SHA-pinned ZIPs; owner extracts/runs on Windows PowerShell 7 and provides logs; ChatGPT repairs and advances. Codex is an independent engineering reviewer after substantial implementation or for a genuine unification blockage; not our primary implementer. No public-chain interaction, out-of-pocket services, credentials or automatic GitHub mutations.


## P06-R4 cutover candidate — November 7, 2026
Owner P06-R3 is green at 98 Fe + 41 Node tests. The R4 package changes the **default** server to one authoritative AllocationFlagship for the seven-view workspace and Guard allocation tab, while retaining governance as separate Fe consumer. See docs/P06_R4_SINGLE_STATE_CUTOVER.md. R4 is **UNVERIFIED** until owner run `P06_R4_GATE=PASS`; do not infer pass from packaging checks. The old incident flow becomes guardian activation -> operator response; old HTTP tests run only under explicit legacy mode. Codex later for independent review.
