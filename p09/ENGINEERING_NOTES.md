# P09 correction semantics and recovery

Base: 5fe196b5c91851131e916024c43e6524f2d9a3c4. This is engineering documentation, not a submission pitch.

## Feasibility
The kernel now constructs the coordinate-wise least permanent state: x=min_x, y=max(min_y,ceil(min_x/ratio)), z=min_z or max(min_z,buffer_min) for delay buffers. Ratio zero requires min_x zero. Every remaining permanent constraint and the proposed incident are checked on this witness. For the supported nonnegative linear TripleLimits policy, any feasible state must be coordinate-wise >= this witness, so upper bounds and available-budget bounds cannot be rescued by choosing larger values. This proves existence for these constraints, not arbitrary predicates or operation-planner completeness. No unrestricted release was added.

## Audit protocol
All five original transaction routes and five Guard routes run inside the same serialized write-ahead mutation wrapper, in both supported runtime modes. Before execution, a local intent records the prior journal size/hash and session. A real completed event, receipt, tx identity, before/after and revision are persisted to the sidecar before append. Post-execution failure returns HTTP 200 with outcome=committed_audit_degraded (or rejected_audit_degraded), result.success retains the actual EVM outcome, retrySafe=false and recoveryRequired=true. All subsequent EVM mutations return 503 until reconciliation. The result is never reported as an EVM revert just because persistence failed.

GET /api/audit/status exposes health and the pending identity. POST /api/audit/reconcile with {} reconciles a recorded outcome without executing any EVM operation. It verifies the exact prior journal bytes and accepts only an empty tail, the identical completed record or an exact prefix of that record. Unexpected data or altered base is refused. Repeated reconciliation does not duplicate history.

On restart the disposable EVM resets. A recorded previous-session receipt can be reconciled as previous-session local evidence; it is never replayed into the new EVM. An intent without an outcome is UNKNOWN. Recovery is blocked until restart plus explicit acknowledgement of the old pendingSession. That acknowledgement records recovery_unknown, never a fabricated successful transaction.

Owner recovery (after inspecting exported journal and the status):
```powershell
$status = Invoke-RestMethod http://127.0.0.1:4549/api/audit/status
# For a recorded outcome:
Invoke-RestMethod http://127.0.0.1:4549/api/audit/reconcile -Method Post -ContentType application/json -Body '{}'
# ONLY for an UNKNOWN prior-session outcome after restart and explicit owner acknowledgement:
$body = @{ acknowledgeUnknownSession = $status.audit.pendingSession } | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:4549/api/audit/reconcile -Method Post -ContentType application/json -Body $body
```
Do not blindly retry a transaction after degradation. Query state/receipt and reconcile first. Do not delete the sidecar to force writes through. Preserve evidence if reconciliation refuses changed bytes.

## Limits
One server process per journal is supported. The local host and files remain trusted; hashes do not authenticate a blockchain. If all persistence becomes unavailable, a known in-memory outcome may be unavailable after process loss: the surviving intent is UNKNOWN, never inferred successful. The protocol detects uncertainty and blocks writes rather than solving distributed consensus. Same-process irreversible EVM effects are not rolled back to conceal a filesystem failure. Test-only fault injection is imported solely by isolated tests/browser acceptance; normal startup never loads it.

## Qualification
Run RUN_P09_WINDOWS.ps1 or bash RUN_P09_UBUNTU.sh. Historical scripts and their freeze checks are preserved in an exact Git-blob archive and checked separately; corrected-source behavior is tested independently. Current-source MANIFEST_SHA256.txt is regenerated deliberately and validated by the gate. The eight original mutants are retained; three additional compiled controls remove incident-ID equality and each deficit comparison separately. Optional browser acceptance requires an external playwright-core module and an existing Chromium executable via P09_PLAYWRIGHT_MODULE and P09_CHROMIUM. No browser result is claimed without its generated receipt/screenshots.

GitHub Actions are pinned to upstream immutable Node24 action revisions. The installer downloads no shell: it authenticates the exact approved Fe26.5.0 Linux binary before installation or execution. OS fingerprints stay platform-specific. A local corrected gate is not corrected-code hosted CI.
