# P04-R2 compiler-arity repair

- Owner P04-R1 report: package preflight PASS; pinned Fe 26.5.0 PASS; library check PASS; library tests 8/8 PASS; consumer check FAIL at line 932.
- Fe diagnostic: expected 10-field `u256` tuple but `KernelMsg::Snapshot` returns 9 fields.
- Repair: change only the test binding annotation at the failing `KernelMsg::Snapshot` call from 10 to 9 elements.
- Complete static audit: 27 directly typed `KernelMsg::Snapshot` call bindings, all have 9 elements.
- No EVM behavior, incident logic, authority, ABI, or suite counts changed.
- Owner P04-R2 compiler/EVM acceptance: PENDING.
- Expected: 8 library + 37 consumer tests, two private-access negative probes, deployable build, ABI inventory.
- Preserve P03 owner-verified fallback and current GitHub main, no publish actions.
