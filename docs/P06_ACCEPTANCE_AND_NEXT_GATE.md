# P06-R1 acceptance and non-drift checkpoint

## Owner gate

- [ ] SHA-256 ZIP matches the published hash.
- [ ] P06 release manifest checks every content file.
- [ ] P04 guarded prefix matches the owner-verified source.
- [ ] P05 full shared-library ingot and all three consumers check/test/build.
- [ ] Original v1.8 contract executes 34 original Fe tests and builds.
- [ ] 3 Fe private-field rejection probes return diagnostic 2-0003.
- [ ] Original Fe unsafe external call rejection returns 16-0001.
- [ ] Old full Node test suite passes 31/31.
- [ ] New real guard EVM tests pass 6/6.
- [ ] New guard HTTP integration passes 2/2.
- [ ] `/guard.html` loads with new real Fe state, and `/` retains the v1.8 workspace.
- [ ] Audited atomic/progressive/release routes and role-based reverts shown in log.

## Result semantics

`P06_R1_GATE=PASS` means the above integrated vertical slice passed on the owner's Windows machine. It does **not** mean the final P06 master-plan requirement of **one unified flagship state** is complete. Preserve `P06_MASTER_FLAGSHIP_CUTOVER=NOT_DONE` until actual full route cutover and original product regression demonstrate it.

## Subsequent essential engineering

P06-R2: port ordered operations into shared Guard3, unify state across original UI and new incident UI, remove duplicate legacy VM when tests support it, preserve the exact goal planner, operations, incident responses and local audit. P07 rigorous independent model vs actual Fe bytecode and all mutating selectors. P08 fresh clones and CI, P09 Codex independent review and release. Preserve registration Nov 17 23:59 UTC and final submission Nov 24 23:59 UTC. No real assets or expensive services.
