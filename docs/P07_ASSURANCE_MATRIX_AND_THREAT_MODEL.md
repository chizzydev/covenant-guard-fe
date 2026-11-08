# P07 — Exact Assumption and Evidence Matrix

## Public flagship interface inventory

11 read-only named ABI methods: `snapshot`, `operator`, `guardian`, `policyConstants`, `canCommit`, `incidentSnapshot`, `incidentDeficits`, `preview`, `previewMigration`, `previewActions`, `previewIncidentActions`.

8 named ABI state writers: `commit`, `commitMigration`, `commitActions`, `commitGoalActions`, `commitIncidentActions`, `activateProgressive`, `activateContain`, `releaseIncidentBound`.

The P07 source-derived and runtime-derived inventory must match EXACTLY. Additional ABI writers block the gate until covered. Source roles: operator/admin may make allocation transitions; guardian alone may activate or release; reviewer is unauthorized. The Python model is independently written and knows only this protocol, not Fe compiler output.

## Cross-product controls

| Control | Verifier | Acceptance |
|---|---|---|
| 3 phases × 3 roles × 8 writers | `p07/spec/matrix.py` + signed `p07/tests/differential.test.mjs` | All 72 comparisons match independent spec with fresh EVM per cell |
| Seeded 701/1701/2701 | Python oracle + signed EVM transactions | 300 full-state comparisons, a mix of acceptance/revert, version/incident ID and deficit equality |
| Finite 6×6×4 grid in each phase | Python oracle + real Fe `preview` static call | All 432 allow/deny results match and storage unchanged |
| Compiler negative controls | unchanged R4 runner | Four expected Fe access/visibility errors, not runtime attack claims |
| P06-R4 application/regressions | unchanged R4 runner | 98 Fe +45 Node tests pass, original source SHA stays unchanged |
| Positive and negative mutation sentinels | `p07/mutation-sentinel.mjs` | All seven pristine paths reject with complete state equality |
| Compiled mutants | `p07/mutation.py` and Fe build per mutant | Compiler success AND targeted real EVM acceptance of formerly rejected path (a killed mutant) |
| Selector provenance | `p07/provenance.mjs` | 19 exactly enumerated names, unique selectors, SHA256 of ABI and bytecode |

## Mutant causal meaning

- **M01 Exposure monotonicity:** Removing exposure-worsening rejection admits Core 400→450 in RECOVERING without reserve progress.
- **M02 Strict progress:** Removing equality-of-deficits rejection permits unchanged recovering state and spurious revision advance.
- **M03 Guardian-only authorization:** Removing `ActivateProgressive` caller check allows reviewer to activate incident.
- **M04 Version binding:** Removing `checked_edit` revision assertion admits a stale ordinary writer.
- **M05 Incident ID binding:** Omitting bound incident ID allows release of a wrong incident.
- **M06 Exact goal:** Removing exact terminal-target assertion admits false goal testimony.
- **M07 Permanent invariant:** Removing final permanent predicate admits Core-to-Supporting paired exposure violation.

The Fe mutators are copied into isolated temporary Fe projects and built, never used by the user-facing server or original `main` project. **Build failure is INVALID; only a compiling mutant that the sentinel catches may be called killed.** The attack sentinels independently establish baseline rejection.

## Important limits

Fe preview coverage uses a deliberately finite grid and three specific state snapshots; it does not exhaust all u256 inputs, paths or compiler optimizations. Actual `ctx.caller()` comes from disposable signed EVM transactions; the demo HTTP role switch is outside production trust. EVM engine is EthereumJS only. Bytecode gas total recorded in replay evidence is diagnostic, not a matched Solidity benchmark.

Compiler issue PR #1933 (upstream Fe projection/finalization order) remains a separate version-specific risk assessment. Stable compiler 26.5.0 smoke tests are evidence only for the exercised constructs and must not be described as proving every compiler lowering pattern safe.
