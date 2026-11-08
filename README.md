# Covenant Guard — Fe-native persistent transition protection

**Development release: P08-CI-R1 public verification candidate (November 8, 2026).**

Covenant Guard is an experimental reusable **Fe 26.5.0** ingot for protecting state transitions with private permanent policy, explicit revision preconditions, and guardian-installed incident obligations. It supports both atomic incident containment and progressive recovery in which neither risk deficit may worsen. It is accompanied by a real local-EVM application and an independent second consumer exercising governance restrictions.

**Start here:** [P08 reproducibility and adoption instructions](p08/REPRODUCIBILITY.md). The main acceptance entry points are `RUN_P08_WINDOWS.ps1` (Windows), `RUN_P08_UBUNTU.sh` (Linux), and `.github/workflows/covenant-guard-verify.yml` (GitHub Actions). There is a conventional top-level `fe.toml` and a shared ingot under `library/covenant_transition`.

## Architecture and scope

- Reusable safety kernel: `library/covenant_transition/src/lib.fe`.
- Single-state flagship: `consumers/allocation_flagship/src/lib.fe`.
- Different domain using the same kernel: `consumers/governance_registry/src/lib.fe`.
- Local application and browser: `app/server.mjs`, `app/public/index.html`, `app/public/guard.html`.
- Independent adversarial specification: `p07/spec/oracle.py`.
- P08 judge witness: `p08/judge-witness.mjs`, checking real signed EVM transactions against the oracle.

**Owner-verified P07 evidence:** 98/98 Fe; 45/45 Node; 15 Python oracle tests; 300 signed-EVM actions; 72 writer/actor/phase cases; 432 previews; and 8/8 compiled security mutants detected. The source transcript is bundled in `evidence/P07_OWNER_REPORTED_RUN_2026-11-08.txt`; the complete reproducible evidence files are generated when the P07 gate runs.

## Safety and provenance

Fe is **not production-ready**, as Fe's documentation states. This repository is a local simulation with synthetic keys, no live funds, no public network and no production identity system. Its proof is bounded empirical testing, not formal verification or an audit. The consumer contract must not expose arbitrary replacement of its private guard wrapper. Guardian authority is intentionally trusted to activate/release protection. The journal is not tamper-proof.

Existing Fe and app core sources are unchanged from the owner-verified P07-R2 package. P08 adds scripts, a root Fe adoption ingot, documentation, and CI wiring. No public repository mutation or deployment was performed by packaging this release.

**Submission note:** Competition registration, public commit SHA, evidence disclosure, and final submitted artifact remain separate from these local test results. AI assistance is used in engineering and will be disclosed in submission materials.

## P08-R4 Ubuntu-only runner repair

The owner-verified P08-R3 Windows gate passed. The Ubuntu P08-R3 run passed all 98 Fe tests and Fe builds, then failed three historical HTTP tests because `COVENANT_RUNTIME=legacy` was missing from their npm child processes. P08-R4 changes **only** the portable acceptance runner, adds a fail-closed mapping preflight, and updates documentation. It runs the historical `smoke` and `guard:http` suites in `legacy` mode, while all flagship suites run in `flagship` mode. Production `npm start` continues to use the flagship by default. The owner subsequently ran P08-R4 on Ubuntu: `P08_LINUX_R4_GATE=PASS`, 98 Fe tests, 45 Node tests, all P07 independent checks and judge witness. Windows P08-R3 previously passed. The owner also separately compared both release receipts: `P08_CROSS_PLATFORM_EVIDENCE=PASS`. These are owner-supplied local results, not a public CI run.

## Public CI publication gate

See [CI publication runbook](p08/CI_PUBLICATION.md) and the fail-closed workflow at [`.github/workflows/covenant-guard-verify.yml`](.github/workflows/covenant-guard-verify.yml). The workflow now triggers on `main`, enforces the independently observed Linux Fe compiler SHA-256, runs the complete P08 security verification, and uploads its new evidence. The publisher `PUBLISH_GITHUB_CI.ps1` targets a **new public repository**; it only performs GitHub mutations when explicitly run by the owner. `P08_PUBLIC_GITHUB_CI_GATE` remains **unverified until a GitHub-hosted run actually succeeds**.
