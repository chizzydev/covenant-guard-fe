# P05 — Security contract for reusable Guard3

## 0. Scope and fidelity

The owner **verified P04-R2** with all 45 Fe tests passed (8 original library / 37 allocation consumer), compiler-private negative controls passed and deployable EVM artifacts built. This new P05 source retains the old P04 library bytes **exactly as a prefix**. An independent C#-equivalent SHA256 prefix check in the PowerShell runner detects any alteration. Old Fe tests are rerun against the modified ingot. The new generic kernel is an **additive extraction feasibility bridge**, not a completed refactor of the existing flagship `AllocationKernel`. The flagship does not yet use `Guard3`; migrate in P06 after matched-model checks.

## 1. Shared generic primitive

`covenant_transition::Guard3` is one Fe type in one `src/lib.fe`, imported unchanged by two separately compiled applications (`consumers/allocation_pilot` and `consumers/governance_registry`). Both use the same `Guard3::checked_edit` finalization and `TripleLimits` structure. The **applications do not copy-paste a safety kernel**; they only supply domain policy parameters and authenticated ABI adapters.

Fields `Guard3.value`, `.rules`, `.revision` and `.incident` are private to the library. `checked_edit` lends only a `TripleDraft`, never metadata. The owning adapter must still restrict all entry points and prevent entire `Guard3` replacement. P01 already demonstrated whole-wrapper replacement by an owner is possible; never claim absolute malicious-consumer isolation.

## 2. Configurable predicates

`TripleLimits(total, reserve_floor, min_x/min_y/min_z, cap_x/cap_y/cap_z, ratio_x_y, buffer_mode)` is a public constructor argument; the library copies it into private metadata. Permanent constraints:
- Every field is within [0, 1,000,000], `min_i <= field_i <= cap_i`.
- `x + y + z <= total` and `x + y + z + reserve_floor <= total` (with bounded arithmetic).
- `x <= ratio_x_y * y` (ratio capped to 10).
- `buffer_mode=0`: emergency buffer = `total - (x+y+z)` (unused allocation capacity).
- `buffer_mode=1`: emergency buffer = `z` (governance execution delay).

**Allocation pilot:** x=Core, y=Support, z=Other; (400,300,100), total=1000, reserve floor=100, caps=(550,500,350), ratio=2, mode=0. Incident Core<=200 AND free reserve>=300.

**Governance registry:** x=Quorum, y=Members, z=MinimumDelay; (5,9,2), minimums=(1,1,2), caps=(20,20,365), ratio=1, mode=1. Incident quorum<=2 AND delay>=7. Thus governance uses a different numerical domain, permanent constraint (quorum<=members) and incident second-buffer meaning—not fake allocation renaming.

## 3. Lifecycle

No incident: permanent safety only. `activate_contain(expected,market,max,buffer_min,target triple)` is atomic; the target must meet both permanent and active incident constraints, else entire transaction rolls back. `activate_progressive(...)` installs an incident objective without changing the triple. It immediately becomes CONTAINED if both deficits are zero; otherwise RECOVERING. For RECOVERING, successful changes must reduce >=1 deficit and increase neither. For CONTAINED, both deficits must remain zero. Guardian may `release_bound` only from CONTAINED and only with exact revision and incident ID. All other entry points call `checked_edit`.

`D=(max(0, selected_field - incident.maximum), max(0, incident.buffer_min - buffer(triple,mode)))` is enforced in Fe. `preview` is read-only and offers a policy mask, never authorization. Revision starts 1, increments on successful commit, activate or release, no revision increments on reads/reverts. Incident ID persists after release and increments on reactivation.

## 4. Trust/limits

- Both adapters authorize via `ctx.caller()`, operator and guardian distinct.
- Guardian forwarders `PilotGuardianFixture` and `GovernanceGuardianFixture` are **OPEN, TEST-ONLY**; do not deploy them as real guardians.
- No real assets, oracle, cash, public-chain transactions, production custody, or irreversible writes.
- Fe compiler access-finalization limitation and previous upstream bug concerns still require P07 adversarial compiler-form tests. This release verifies the actual pinned 26.5.0 in the owner's environment, **not** a formal proof.
- The general engine is deliberately finite: three `u256` fields with parametrized bounded linear constraints and two buffer modes. It is **not** a generic arbitrary-predicate framework or a permissionless policy language. No claim that Solidity cannot implement equivalent checks.
- Original P04 `Guarded` and new P05 `Guard3` coexist. Duplication is temporary until audited P06 cutover; do not present as a completed unification.

## 5. Mandatory acceptance

`P05_GATE=PASS` requires pinned compiler checksum, source hash manifest, old P04 source prefix, library tests 11/11, original P04 adapter tests 37/37, 4 allocation pilot EVM tests, 4 governance EVM tests, negative private access compiler probes, and successful builds / ABI inventories of **three separately compiled adapters**. Failed local Fe compilation means NOT PASS, even if the ZIP passes integrity. Owner returns `results/P05_RUN_LOG.txt` for repair.
