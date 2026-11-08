# P06-R4 — Authoritative Flagship Cutover

## Verified prior checkpoint

Owner Windows P06-R3 log (November 7, 2026) confirmed **98/98 Fe tests and 41/41 Node tests**, all expected compiler-negative tests, all build/ABI controls and the isolated flagship EVM qualification. R3 itself was **not** the HTTP cutover.

## R4 design decision

Default `npm start` now creates **one allocation authority**: `AllocationFlagship`, the Fe `covenant_transition::Guard3` consumer. The original seven-view application and the allocation panel of `/guard.html` call the *same signed local EVM contract*, using `app/flagship-runtime.mjs`. The original `CovenantControl.fe` contract and `app/chain.mjs` remain only as regression/reference assets; they are not deployed in the default server.

The separate `GovernanceRegistry` contract remains an independent second domain. Its disposable sandbox uses its own local EthereumJS VM (not a shared production network or shared asset ledger). This is openly disclosed; our claim is reusable Fe source and one **allocation** state, not a single chain spanning both domains.

### Preserved seven-view features

- Configuration Desk: direct preview/commit, signer and version checks.
- Migration Studio: one to three ordered field writes and per-stage diagnostics.
- Operations Studio: MOVE, RETIRE, ISSUE, EXPECT; ordering matters.
- Goal Planner: bounded candidate search, Fe preview, exact goal committed inside Fe, stale/digest checks.
- Incident Desk: prospective Fe response planning, then **explicit guardian activation of persistent incident** before operator response. The supplied incident fields MUST equal stored Fe incident fields; future changes require guardian release after containment.
- Policy Catalog: reads immutable Fe rules via flagship getters.
- History: one hash-linked local journal records flagship and Guard transactions, including full protected snapshots for principal writers. This journal is not tamper-proof.

### Security commitments

1. No default HTTP endpoint can instantiate the legacy allocation contract or standalone P05 allocation pilot.
2. The Fe `Guard3` value and rules are private to the flagship; no wrapper-replacement selector is exposed. The consuming contract remains part of the trusted computing base (whole-wrapper replacement remains possible in deliberately malicious consumer source).
3. Role selection is an **unauthenticated demo account switch**; private keys are synthetic and server-side only. Never deploy/use for real assets.
4. Guardian and operator roles are distinct at the Fe contract level. The Incident Desk must not auto-sign the guardian action when an operator requests a response.
5. `COVENANT_RUNTIME=legacy` is **explicitly test-only** to preserve the already verified R3 HTTP behavior; the normal/default `npm start` uses the new flagship. The R4 acceptance runner uses both modes as separately labeled tests and verifies the default path through four new signed-EVM HTTP tests.
6. Persistent incident risk constraints are verified by Fe on direct setters, multi-write migrations, ordered operations, and goal-attested incident commitments, including rollback/revision checks.
7. The governance domain is **not** the authority for the flagship allocation state.
8. The browser presents results and permits manual demo role selection; it is not a production authorization boundary or a risk oracle.

### Deliberate compatibility distinctions

- P06-R3 original HTTP regression tests are run with `COVENANT_RUNTIME=legacy`. This preserves test reference data; it does not pretend that former ad hoc incident commits are still accepted by the flagship.
- P06-R4 default-path tests prove the new guardian activation requirement and the shared allocation state across the two browser pages.
- Fe `Guard3` diagnostic bit positions are intentionally mapped to the older UI bit conventions without dropping the incident bit 128 or operation bit 256. For a previously unavailable lower-bound failure, the adapter assigns UI bit 512.
- Separate local EVMs mean allocation and governance can have independent transaction nonces. The demo's governance deployer nonce is initialized at 1 to avoid misleading identical contract addresses on separate VMs.
- `Guard3` supports up to three ordered operations per call; this is not global unreachability proof for plans requiring more operations.
- No Fe/EVM execution was performed in the assistant packaging sandbox; test counts and `P06_R4_GATE` are **targets**, not claims, until the Windows runner completes.

## Acceptance

The `RUN_WINDOWS.ps1` gate checks 98 Fe tests and the original 41 Node tests, then adds four full-cutover tests (expected **45 Node tests total**):

1. Main desk, migration, operation and planner success; a Guard allocation commit updates the same flagship revision; governance remains independent.
2. Guardian-only activation, strict progressive deficit monotonicity, no bypass through ordinary writers, bound guardian-only release.
3. Prospective incident recommendations cannot be committed until an explicitly stored Fe guardian objective matches; incident response is Fe-attested and the journal preserves evidence.
4. Guardian atomic containment through Guard tab, shared main state, final-state nonregression, bound release.

**Do not mark P06-R4 done before the owner Windows run returns `P06_R4_GATE=PASS`.** On failure, preserve `results/P06_RUN_LOG.txt`, repair in a new R4 revision, and rerun all gates. The former R3 zip is the unmodified rollback checkpoint.

## Next phase

P07 — cross-layer model comparison, mutation/falsification controls, randomized adversarial sequences, model-to-Fe/EVM differential checking, role abuse tests, compiler issue scope, and independent security review before public release.
