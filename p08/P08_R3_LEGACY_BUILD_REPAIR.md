# P08-R3 — Explicit legacy contract build project

## Observed Windows failure
P08-R2 owner result: the isolated `error[16-0001]` compiler-negative check passed (in the early preflight AND baseline); the 98 Fe tests passed; all other P06 builds passed. The P06 baseline then failed at `P06_BUILD_LEGACY_EXIT=1` with `Error: No contracts found to build`. No Node/P07/P08 judge stages ran in that P08-R2 attempt.

The new root `fe.toml` introduced in P08 changes how Fe resolves a standalone file during **contract build**. We previously compiled `fe build --out-dir <artifacts> contracts/CovenantControl.fe` when the project had no root ingot. The file still passed `fe check` and all 34 tests in P08-R2, but this build invocation produced no contract. The exact mechanism remains a working hypothesis until the owner's compiler run; a separate Fe ingot removes that ambiguity.

## Surgical repair
- Keep historical `contracts/CovenantControl.fe` byte-for-byte intact and keep running its original 34 `check`/`test` cases.
- Add `probes/legacy_build_fixture/fe.toml` with `src/lib.fe` copied **byte-for-byte** from the historical contract.
- Change only the P08-adapted Windows baseline `RUN_BASELINE_P08_WINDOWS.ps1` legacy `fe build` target to this ingot; keep output in `artifacts`, so existing ABIs, Node tests, and P07 provenance paths stay intact.
- Change the Ubuntu portable runner's `P08_BUILD_LEGACY` target to this same ingot.
- Add `p08/legacy-build-probe.mjs`: verify fixture source-byte identity, perform a **real Fe build before the full P07 replay**, and require both contracts' `.bin`, `.runtime.bin`, valid `.abi.json` artifacts. The preflight runs in both OS paths. It does not accept a fake or unbuilt success.
- Preserve `RUN_BASELINE_WINDOWS.ps1`, `docs/P06_R4_VERIFIED_SOURCE_MANIFEST.txt`, Fe kernel, flagship, governance, app, and all P07 reference code unchanged.

This is a build/project-resolution repair, not a claim that the P08 qualification is already green. Windows and Ubuntu runner executions remain the acceptance authority.
