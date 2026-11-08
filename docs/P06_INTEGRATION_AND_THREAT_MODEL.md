# P06-R1 real EVM application integration — exact semantics

## Build topology

`library/covenant_transition/src/lib.fe` is the **single** Fe source of Guard3; the allocation pilot and governance registry import it via `fe.toml`. The original P04 `Guarded` in that ingot also remains present and fully regression-tested. `contracts/CovenantControl.fe` is the *unchanged* v1.8 legacy contract so we can catch compatibility regressions rather than delete inconvenient tests.

`app/guard-chain.mjs` creates an isolated EthereumJS VM, deploys both P05 contracts with a real separate guardian EOA address encoded as their constructor parameter, reads the true generated ABIs, sends signed **real local transactions**, and returns each Fe-generated incident/deficit/snapshot. It does not reimplement the predicate or decide whether a transition is safe.

`app/server.mjs` serves the existing seven-view workspace on `/` and the new visual guard lab on `/guard.html`, all on 127.0.0.1:4549. `app/guard-api.mjs` exposes typed JSON routes under `/api/guard/` with the shared serialized VM queue. `app/public/guard.js` only presents real response data; it cannot approve a transaction without a Fe EVM call.

The v1.8 `app/chain.mjs` uses a **separate** local EVM for the legacy workspace. P06 final cutover is pending, not hidden. All P05 Guard3 routes use ONE shared VM containing two independently deployed contracts.

## Guard3-specific endpoints

| Endpoint | Input | Fe method |
| --- | --- | --- |
| `GET /api/guard/state` | none | both `snapshot`, `incidentSnapshot`, `deficits`, `operator`, `guardian` |
| `POST /api/guard/preview` | domain, role, expectedVersion, x,y,z | `preview` (static) |
| `POST /api/guard/commit` | domain, role, expectedVersion, x,y,z | `setAllocation` or `setConfiguration` |
| `POST /api/guard/migrate` | domain, role, expectedVersion, first, firstValue, second, secondValue | `reallocate`; governance requires members then quorum |
| `POST /api/guard/activate` | domain, role, expectedVersion, mode, market, maximum, bufferMinimum, x/y/z only for atomic | allocation `activateRecovery`/`activateAtomicRecovery`; governance `activateRestriction`/`activateAtomicRestriction` |
| `POST /api/guard/release` | domain, role, expectedVersion, incidentId | `releaseRecovery` / `releaseRestriction` |

`expectedVersion` and the incident ID are passed through Fe ABI as actual uint256, not trusted to JS. New write endpoints run a before/after protected snapshot check: rejected EVM tx must preserve all fields; accepted tx must increment exactly one revision. They append a linked local audit record with the tx hash, roles, Fe error and before/after.

## Safety boundaries

- **Actor authority:** Fe `ctx.caller()` enforces authorization. The demo server freely lets viewers select synthetic keys; it cannot be deployed with funds or described as real authentication.
- **Guardian separation:** P05 alloc and governance constructors set a guardian EOA different from the operator; the test-only permissive forwarder contracts are **never** deployed by P06 server.
- **Incident:** INACTIVE (0), RECOVERING (1), CONTAINED (2). Each nontrivial successful guarded edit while recovering must strictly improve at least one deficit and worsen neither. Contained edits must preserve both deficits at zero.
- **Permanent rules:** Applied by Fe on every guarded transition and checked after the borrowed mutable projection is finalized. Safe multi-step migration can temporarily violate individual checks.
- **Read-only preview:** Fe supplies its mask; EVM actually rejects invalid transactions. The display's role-equality check is supplementary, not an independent Fe authorization proof.
- **Journal:** local hash-linked JSONL records; the owner of local files can rewrite it. EVM state resets on restart.
- **Whole-wrapper trust:** P01 showed an integrator can reassign an entire `Guard3`; the owner adapter's write routes remain trusted application code, not protected by the ingot in isolation.

## Explicit unfinished work

1. `Guard3` lacks the original P04's ordered MOVE/ISSUE/RETIRE/EXPECT and multi-operation goal-attested methods. These must be ported and all old behavior/regression tests preserved **before** replacing the old application EVM state.
2. The old incident desk uses caller-supplied per-transaction limits. The new guard lab uses stored immutable incident constraints until guardian release. Do not conflate them in the UI or submission pitch.
3. The general library currently implements exactly a three-field numerical state and two supported buffer policies. It is not arbitrary-layout, arbitrary-code, or formal verified universally.
4. This is an app-level integration candidate, not adversarial P07 closure or a production security audit.
