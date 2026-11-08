# P08-R2 — Isolated external-call compiler-negative control

Owner's P08-R1 Windows run passed package checks, the Fe 15+37+4+4+4+34 = 98 baseline tests, and the three private-field compiler probes. It stopped at `P06_EXTERNAL_CALL_CONFLICT_EXIT=0`; unlike P07-R2, the compiler no longer emitted the expected `error[16-0001]` when checking `contracts/IllegalCall.negative.fe` from the new root ingot. **This is a harness resolution failure, not proof that Fe permits reentrant calls during open mutable storage access.**

P08 introduced a root `fe.toml`; P07 did not have one. To avoid ambiguous single-file source resolution, P08-R2 copies the *exact bytes* of `contracts/IllegalCall.negative.fe` to `probes/external_call_conflict/src/lib.fe` with its own `fe.toml` and invokes `fe check probes/external_call_conflict`. This is the same project-based isolation already used by the private-field negative probes. The gate still **requires a nonzero compiler exit and the exact `error[16-0001]`**; no weakening or expected-diagnostic substitution.

`p08/negative-probe.mjs` checks byte-for-byte fixture equality and runs this test before the full Windows/Ubuntu replay. The P06 Windows baseline and Linux portable test also invoke the isolated project later. A compile success, an unrelated parse failure, or fixture drift remains a hard failure.

The P07 provenance collector also demands the previously owner-verified P06-R4 `RUN_WINDOWS.ps1` bytes remain unchanged in `RUN_BASELINE_WINDOWS.ps1`. Therefore **the frozen baseline file is not patched**. The modified P08 replay lives in a separate `RUN_BASELINE_P08_WINDOWS.ps1`, selected by the P08 dispatcher; the original immutable file remains available for byte-for-byte verification. This avoids a future `FROZEN_P06_SOURCE_DRIFT` from the fix itself.

All Fe kernel, flagship and governance sources, JavaScript application code, Python oracle, P07 differential tests and mutation recipes are unchanged. Prior P06/P07 green runs remain the baseline, not a substitute for new P08-R2 Windows or Ubuntu evidence.
