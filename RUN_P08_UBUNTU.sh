#!/usr/bin/env bash
# Portable Ubuntu/Linux acceptance. Run from a fresh checkout or ZIP extraction.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
printf '%s\n' '=== COVENANT GUARD P08-R1 LINUX ACCEPTANCE ===' 'ADMIN_REQUIRED=NO' 'PUBLIC_CHAIN=NO' 'REAL_FUNDS=NONE' 'GITHUB_MUTATION=NONE'
if [ -z "${P08_FE_EXE:-}" ]; then
  if [ -x "$HOME/.fe/bin/fe" ]; then export P08_FE_EXE="$HOME/.fe/bin/fe";
  elif command -v fe >/dev/null 2>&1; then export P08_FE_EXE="$(command -v fe)";
  else printf '%s\n' 'ERROR=FE_NOT_FOUND_RUN_bash_scripts_INSTALL_FE_UBUNTU.sh'; exit 1; fi
fi
if ! command -v node >/dev/null 2>&1; then printf '%s\n' 'ERROR=NODE_NOT_FOUND';exit 1;fi
if ! command -v npm >/dev/null 2>&1; then printf '%s\n' 'ERROR=NPM_NOT_FOUND';exit 1;fi
if ! command -v python3 >/dev/null 2>&1; then printf '%s\n' 'ERROR=PYTHON3_NOT_FOUND';exit 1;fi
export P07_PYTHON="$(command -v python3)"
node p08/portable-gate.mjs
