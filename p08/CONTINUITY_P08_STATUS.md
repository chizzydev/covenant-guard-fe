# Covenant Guard P08-R3 continuity checkpoint (2026-11-08)

**Last trusted owner engineering gate:** P07-R2 Windows executed `P07_R2_GATE=PASS`, with 98 Fe, 45 Node, 15 Python, three 100-action independent EVM replays, 72 selector/actor/phase cases, 432 policy previews, and eight compiled mutant kills. The source transcript is `evidence/P07_OWNER_REPORTED_RUN_2026-11-08.txt`. P06 flagship cutover to one allocation state is already PASS.

**New work THIS package:** conventional root `fe.toml` and dependency-ingot smoke test; Ubuntu/Linux portable full security/replay/test suite; GitHub Actions Ubuntu workflow; fresh Windows P08 wrapper that exercises P07 first and then tests a six-action judge witness and provenance receipt; OS-specific Fe SHA recorded; docs and git normalization safeguards. The prior Fe kernel, flagship, governance, app and P07 specification are preserved.

**Do NOT claim:** P08 Windows PASS before owner runs it; Ubuntu PASS before real Linux execution; CI green before a GitHub Actions run; root ingot compiles until Fe checks it; cross-platform bytecode equivalence until artifacts from both operating systems are compared; public deploy; production readiness; formal proof.

**Next action:** run `RUN_P08_WINDOWS.ps1` in a fresh extracted ZIP. If green, execute `scripts/INSTALL_FE_UBUNTU.sh` if needed and `RUN_P08_UBUNTU.sh` inside Ubuntu 24.04. Compare `results/p08/P08_REPRODUCIBILITY_RECEIPT.json` from Windows and Ubuntu and pin the independently recorded Linux Fe SHA. Repair actual failures before P09. A final release must also have real GitHub CI, approved OSI license and repository commit, contest registration, judged SHA, judge README and submission acknowledgement.

**Work division:** ChatGPT authors code packages, owner runs scripts & returns logs, Codex is independent engineer/auditor late in the process; submission/media/README handled by owner and ChatGPT. Keep baseline repository main untouched until owner approves release push.

**Competition timing:** registration closes 2026-11-17 23:59 UTC, final submission closes 2026-11-24 23:59 UTC. Registration still unconfirmed in this chat; do not assume.

P08-R4 Linux mode-isolation correction: historical Node suites require `COVENANT_RUNTIME=legacy`; flagship suites remain in `flagship`. See `p08/P08_R4_LINUX_RUNTIME_REPAIR.md`.
