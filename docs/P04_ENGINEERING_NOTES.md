# P04-R1 implementation / acceptance boundary

- Source parent: COVENANT_GUARD_P03_R1, owner `P03_GATE=PASS` with 29 Fe tests (5 library + 24 consumer).
- Two-dimensional incident deficit: max(0,exposure-max), max(0,min_reserve-free). No total-score or lexicographic tradeoffs permitted.
- RECOVERING checks previous + proposed state under one Fe projection slide, after permanent policy; both deficits nonincreasing, some strict decrease.
- On D=(0,0), phase becomes CONTAINED as part of same checked transition, with one revision increment.
- P03 atomic activation remains supported; progressive activation increments revision once and leaves allocations unchanged.
- All P02 ordinary setter routes still share `checked_edit`; `commit_incident` now supports recovering with exact stored parameters.
- Reader ABI `incidentDeficits` and guardian ABI `activateProgressive` and `releaseIncidentBound` added.
- Compatibility legacy guardian `releaseIncident(expected)` remains; only `releaseIncidentBound` is explicitly ID-bound. Do not misstate this.
- EVM tests target authorized regression, trade-off attack, no-op, EXPECT-only, stale version, unauthorized guardian, phase transition, rollback, all legacy mutators, partial preview semantics.
- P04 new code has not been executed with Fe 26.5.0 here; owner gate and repair loop determine acceptance.
- Future P07: independent Python oracle execution vs Fe bytecode; bounded exhaustive + seeded sequences; compiler-form mutants and full-state storage snapshot checks.
