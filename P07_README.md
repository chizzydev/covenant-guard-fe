# Historical P07 instructions — superseded by completed owner P07-R2 run

The owner ran this exact P07-R2 gate on November 8, 2026. The supplied transcript is in `evidence/P07_OWNER_REPORTED_RUN_2026-11-08.txt` and reports `P07_R2_GATE=PASS` (98 Fe tests, 45 Node tests, 15 Python tests, 300 EVM actions, 72 matrix cells, 432 previews, 8 compiled mutants detected). This file describes the historical pre-run state and remains for source continuity. **For the current release, follow `README.md` and `p08/REPRODUCIBILITY.md`.**

---

# Covenant Guard P07-R1 — Independent Adversarial Assurance

**Status on packaging:** SOURCE-CHECKED / PYTHON MODEL 15 TESTS PASS; **FE/EVM P07 GATE NOT YET RUN**. Owner's P06-R4 run (Nov 7/8, 2026) independently reported `P06_R4_GATE=PASS`, **98 Fe + 45 Node/EVM/HTTP PASS**. This package copies that owner-qualified baseline without modification. P07-R1 does not write to GitHub or deploy to a public network.

## What P07-R1 adds

- Independent, standard-library-only Python transition model in `p07/spec/oracle.py`. It intentionally imports **no Fe code, JavaScript business logic, ABI artifacts, or EVM state**. Requirements come from the combined master plan and incident lifecycle specification.
- Three deterministic 100-command mixed accepted/rejected traces, with seeds **701, 1701, 2701**. The Node replay deploys the **real compiled Fe `AllocationFlagship` EVM bytecode** and compares every transaction's success, complete revision/allocation/incident/deficit state, and rollback against the Python model. First divergence is written to `results/p07/P07_FIRST_DIVERGENCE.json`; `node p07/reduce.mjs` can shrink a reproducing trace after failure.
- **72-cell signed-EVM matrix**: 3 incident phases × 3 real EOA caller roles × all 8 publicly exposed writer ABI methods. Each cell begins on a **fresh independent local VM** for its phase and checks both state and return success, with no HTTP adapter.
- **432 Fe static previews**: fixed 6×6×4 candidate grid evaluated separately in INACTIVE, RECOVERING and CONTAINED, against independent Python predictions, ensuring previews leave storage unchanged.
- Seven explicit **security mutation controls**, each cloned into `results/p07_mutants/<ID>` only at execution time, compiled with pinned Fe, and considered `KILLED` **only** if a real signed-EVM sentinel confirms the specific prohibited transition on the mutant, while the same sentinel rejects and rolls back on the pristine build. A compiler-rejected mutant is INVALID, not KILLED.
- Strict full 19-method ABI inventory (8 writers, 11 readers), bytecode and ABI SHA-256 in `results/p07/artifact-provenance.json`.
- Complete **P06-R4 baseline gate**, including existing 98 Fe and 45 Node cases, expected compiler negative tests and all contract builds, before running P07 additions.

## Windows 11 / PowerShell 7 runner

Extract into a fresh folder, then from that folder:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\RUN_P07_WINDOWS.ps1
```

No administrator, real key, public chain, live network, or GitHub mutation. The same pinned Fe 26.5.0 binary from P06 is required; the R4 gate checks its SHA256. **Python 3.11+** and Node 20+ are also needed. `npm ci` only if locked dependencies missing, as in P06. The runner writes `results/P07_RUN_LOG.txt`, seeded traces and the matrix to `results/p07/`, and mutant compilation output to `results/p07_mutants/`.

Expected terminal marker **only if everything passes**: `P07_R1_GATE=PASS`.

## Limits that remain in force

- These are bounded executed tests, **not formal proof**, not fuzzing of an infinite input space, and not an independent EVM implementation (the runtime is still EthereumJS). The Python *specification* is independent.
- The seven-view demo uses synthetic server-owned test keys with UI-selectable roles, **not production authentication**. No custody, oracle, live asset or external chain.
- The `.jsonl` journal is hash-linked local evidence, **not tamper-proof**; local EVM state resets on restart.
- The actor matrix covers every current public write selector of `AllocationFlagship`; ABI changes must add tests instead of silently skipping routes.
- The whole-wrapper replacement boundary remains trusted consumer code; no library can prevent an intentionally malicious wrapper owner from reassigning its own storage if it provides such an entry point. The actual flagship exposes no such setter.
- Upstream Fe compiler version limitations are not magically repaired. The pinned compiler and generated ABI/bytecode must be recorded.
- Mutation sources are generated ONLY in ignored `results/` and intentionally excluded from the release ZIP. The ZIP includes recipes and sentinels so that reviewers can reproduce killing evidence.

## Safe continuation

- If `P07_R1_GATE=FAIL`: preserve the entire log and `results/p07/P07_FIRST_DIVERGENCE.json` (if produced). Determine whether the failure is in the model, EVM transport, Fe implementation, or Windows runner **before** changing any policy semantics. Minimize actual divergence using `node p07/reduce.mjs` with the same pinned test toolchain; preserve the original trace.
- If the gate passes: start **P08** reproducibility, Linux/Windows fresh workspace, CI and judge demo; request independent **Codex engineering review** later for substantive review and fixes. Publication materials stay with owner + ChatGPT.
- The official registration deadline and judged final-commit deadline remain independent, time-sensitive obligations. Do not assume registration was completed.

**Baseline verified owner run:** P06-R4 98/98 Fe +45/45 Node PASS. **P07-R1:** awaiting Windows execution.
