# Covenant Guard — P06-R4 Single-State Flagship Cutover

**Status:** engineering candidate. Package integrity and static JavaScript checks only have been run in the packaging sandbox. The pinned Fe compiler and npm EVM packages are not available there; real acceptance requires the owner Windows runner.

### What changed from owner-verified P06-R3

The *default* localhost server now deploys **one allocation Fe contract**, `AllocationFlagship`, via `app/flagship-runtime.mjs`. Both the established seven-view Covenant Control workspace (`/`) and the allocation tab of the Guard3 demo (`/guard.html`) use that same allocation state and guardian incident history. Governance stays an independent second domain. This is a genuinely integrated read/write path, not a dual-state visual comparison.

The Incident Desk now explicitly requires a guardian to activate a persistent incident in Fe before a separate operator can commit an incident response. The UI shows prospective plans and offers an explicit guardian activation action. Neither client-side role choice nor server-held demo keys constitute production authentication. No real funds, secrets, public RPC or hosted deployment.

**Read** `docs/P06_R4_SINGLE_STATE_CUTOVER.md` for the full trust model, regression scope, prior behavior compatibility and known limitations.

### Owner acceptance (Windows 11 / PowerShell 7)

Extract this ZIP to a fresh folder. From the folder run:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\RUN_WINDOWS.ps1
```

`fe.exe` is expected at `$HOME\Downloads\FE_PROGRESSIVE_DECISIVE_GATE\toolchain\fe.exe` and verified by SHA-256, or set `FE_EXE` to the *same pinned* executable. `npm ci` installs exact locked dependencies only if absent. No admin privileges. No GitHub changes.

The runner checks **98 Fe tests** and **45 Node tests** (31 original legacy regression, 6 P06 Guard EVM, 2 original Guard HTTP regression, 2 R3 flagship candidate and 4 R4 main HTTP cutover), negative compiler probes, ABIs and source hashes. The original legacy HTTP suite is **explicitly isolated in `COVENANT_RUNTIME=legacy`**; the R4 tests run with the actual flagship mode. `RUN_WINDOWS.ps1` prints `P06_R4_GATE=PASS` only after every gate succeeds.

If it fails, upload the complete `results/P06_RUN_LOG.txt`. **Do not run `npm start` or claim cutover completion if a critical gate fails.**

### Once green

In the extracted folder run `npm start`. Open:

- `http://127.0.0.1:4549/` — seven-view flagship app backed by `AllocationFlagship`.
- `http://127.0.0.1:4549/guard.html` — one allocation flagship plus a different governance consumer.

The server binds only to `127.0.0.1`. Any transaction writes to a disposable in-memory local EVM, and the hash-linked local audit journal survives restart separately. EVM state resets on restart. The journal is not tamper-proof. The UI can select demo roles, so it must **not** be treated as genuine authentication.

### Milestone

P01, P02, P03, P04, P05 and P06-R3 are owner-verified passing checkpoints. **P06-R4 is pending execution.** After pass, continue P07 independent specification/model-vs-EVM assurance; Codex remains reserved for later independent engineering review.
