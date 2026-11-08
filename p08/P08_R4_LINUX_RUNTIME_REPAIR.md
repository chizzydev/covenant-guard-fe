# P08-R4 — Linux historical/flagship test runtime separation

## Evidence from the owner's P08-R3 Ubuntu log (Nov 8, 2026)
- `P08_FE_98_TESTS=PASS`, all four negative controls `PASS`, all five Fe contract builds `PASS`, npm installation and JS syntax `PASS`.
- At `STAGE=P08_NODE_LEGACY`, 31 Node tests ran: 28 passed, 3 failed (tests 8-10 in `app/tests/http.test.mjs`).
- Two tests received `requires_guardian` where the historical legacy server returns `assessed` or `unreachable`; another received zero available incident proposals instead of three.
- The default P06-R4 server runs `AllocationFlagship` unless `COVENANT_RUNTIME=legacy`. The verified Windows baseline explicitly sets `COVENANT_RUNTIME=legacy` for `smoke` and `guard:http`; the Linux runner did not.

## Surgical change
- `p08/portable-gate.mjs`: each Node test stage now receives an *explicit child-only* `COVENANT_RUNTIME`, using `legacy` for historical `smoke` (31) and `guard:http` (2), `flagship` for `guard:unit` (6), `flagship:candidate` (2), and `flagship:cutover` (4).
- Added `p08/runtime-mode-preflight.mjs` to verify the mode map, explicit child environment, and unchanged flagship default before replay.
- Record `P08_NODE_<SUITE>_RUNTIME_MODE`, `P08_NODE_LEGACY_AND_FLAGSHIP_MODE_ISOLATION=PASS`, `P08_NODE_RUNTIME_ISOLATION_PREFLIGHT=PASS`.
- Linux terminal success is now `P08_LINUX_R4_GATE=PASS`, only after complete original P07 assurance, eight mutants and the judge witness.

**Zero changes** to the Fe kernel, consumer contracts, server, browser, security controls, Python model, P07 tests or Windows runner. The Windows P08-R3 gate remains the last owner-verified Windows success. New R4 Linux acceptance remains pending.
