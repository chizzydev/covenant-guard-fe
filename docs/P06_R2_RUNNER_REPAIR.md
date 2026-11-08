# P06-R2: Node 24 PowerShell summary-prefix parser repair

## Owner-provided evidence (November 7, 2026)

P06-R1 passed the package manifest and SHA checks, pinned Fe 26.5.0, 90 Fe tests, negative compiler controls, bytecode/ABI builds, locked npm install, and JavaScript syntax validation. It then ran the 31 existing Node tests: **tests=31, pass=31, fail=0**. The PowerShell runner rejected this output with `P06_NODE_LEGACY_REGRESSION_NODE_TEST_COUNT_MISMATCH=31`.

The exact cause is a text-decoding mismatch in the runner. It only recognized `ℹ` or `#` as a summary-line marker but Windows presented the information glyph as `Γä╣`, e.g. `Γä╣ tests 31` and `Γä╣ pass 31`. This is a **harness false negative**, not a failing application test.

## Patch

`RUN_WINDOWS.ps1` now matches exactly one optional short nonspace marker before each authoritative summary metric. It still verifies **all three** independently: `tests=expected`, `pass=expected`, `fail=0`. Built-in PowerShell fixtures test normal, hash, unprefixed, and Windows-mojibake outputs, and reject mismatches or missing `fail` lines.

No contract, library, application, test, lockfile, or EVM behavior is changed. The ZIP is a fresh isolated R2 release. `P06_FE_90_TESTS`, `P06_NODE_39_TESTS`, and source-integrity requirements have not been relaxed. Runner still executes the full Fe and Node suite, including the previously unexecuted 6 Guard EVM and 2 Guard HTTP tests.

## Evidence caveats

R2 author environment lacks pinned Fe 26.5.0 and npm dependency cache, so **full R2 acceptance is pending the owner's Windows run**. The previous successful Fe and legacy Node results carry over as evidence of source behavior, not as a substitute for executing R2. `P06_R2_GATE=PASS` is meaningful only if the owner reaches it. Even a successful P06-R2 run is a vertical slice; **single-state flagship cutover remains NOT DONE**.
