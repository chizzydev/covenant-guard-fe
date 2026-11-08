# P08 CI publication runbook (2026-11-08)

## Verified inputs

- Local **Windows P08-R3**: `P08_WINDOWS_R3_GATE=PASS` (98 Fe, 45 Node, P07 300/72/432, 8 compiled mutants, witness).
- Local **Ubuntu P08-R4**: `P08_LINUX_R4_GATE=PASS` (same security counts and witness).
- Owner's subsequent cross-platform comparison: `P08_CROSS_PLATFORM_EVIDENCE=PASS`.
- Approved Ubuntu Fe v26.5.0 x64 SHA-256: `3732fbe8a6e9d2ea3925d02d0e3a1478bc1e01d742c2be75d3ea7300c46c45f0`.
- Windows Fe fingerprint is different by design. Source and compiled flagship hash matched across both OS runs.

## Publication operation

The repository target is `chizzydev/covenant-guard-fe` **public**. The bundled `PUBLISH_GITHUB_CI.ps1` (PowerShell 7) checks `gh`, `git`, authenticates using your existing GitHub CLI login, refuses to overwrite any existing repository, validates every source SHA, creates a single initial `main` branch commit, and calls `gh repo create --public --source . --remote origin --push`. It does not store a token, change your global Git config, push to an unrelated repo, or create paid cloud resources. The remote creation/push happens only when the owner executes the script.

Install the official GitHub CLI if missing; `gh auth login --web` is the required account authorization. GitHub Actions on a new public repository runs under the standard free hosted-runner allocation/policies applicable to the account; review any account-specific Actions settings and usage.

## CI final gate

The workflow `.github/workflows/covenant-guard-verify.yml` runs on the first push to `main`, through a PR, or via manual `workflow_dispatch`. It uses `ubuntu-24.04`, Node 24, Python 3.12, a pinned Fe 26.5.0 installer source, and the independently approved Fe **binary SHA**. It runs the unchanged `RUN_P08_UBUNTU.sh` and fails unless all 98 Fe tests, 45 Node tests, Python oracle, 300 seeded signed transactions, 72 actor/selector/phase cases, 432 Fe previews, 8 compiled mutants, six-action judge witness and release provenance pass. It uploads generated manifests and logs as workflow artifacts.

**Claim `P08_PUBLIC_GITHUB_CI_GATE=PASS` only after inspecting an actual successful GitHub-hosted run and its specific commit SHA.** No GitHub Actions result is present in this source package.

## Public source considerations

This repository is a Fe 26.5.0 experimental local-EVM prototype with **synthetic test-only account keys**. Never send funds to its hard-coded local addresses or reuse its test keys. The archived owner test transcript contains local file paths and disposable session metadata. No live wallet or cloud credentials should ever be added. The included LICENSE is MIT. The release uses an independent second consumer of the Fe guard; it is not a production audit.
