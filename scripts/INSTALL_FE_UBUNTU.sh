#!/usr/bin/env bash
# Optional official Fe 26.5.0 release installer for user's Ubuntu VM / CI.
# Fetches the INSTALLER from immutable v26.5.0 TAG, saves it first, then executes.
# Does NOT install to project or modify shell profile. Review before execution.
set -Eeuo pipefail
printf '%s\n' '=== PINNED FE 26.5.0 LINUX INSTALL ===' 'SOURCE=argotorg/fe tag v26.5.0' 'NETWORK=REQUIRES_GITHUB'
command -v curl >/dev/null || { echo 'ERROR=CURL_REQUIRED';exit 1; }
INSTALL_URL='https://raw.githubusercontent.com/argotorg/fe/v26.5.0/feup/feup.sh'
TEMP="$(mktemp -d)"
trap 'rm -rf "$TEMP"' EXIT
curl --fail --location --silent --show-error "$INSTALL_URL" -o "$TEMP/feup.sh"
sha256sum "$TEMP/feup.sh"
# Official Fe guide documents feup --version v26.5.0.
bash "$TEMP/feup.sh" --version v26.5.0 --no-modify-path
FE="$HOME/.fe/bin/fe"
[ -x "$FE" ] || { echo 'ERROR=INSTALLED_FE_NOT_FOUND'; exit 1; }
"$FE" --version | tee "$TEMP/version.txt"
grep -Fq 'fe 26.5.0 (3dab95f)' "$TEMP/version.txt" || { echo 'ERROR=INCORRECT_FE_VERSION';exit 1; }
sha256sum "$FE"
printf '%s\n' 'FE_26_5_0_LINUX_INSTALL=PASS' 'NOTE=Record this platform-specific fe SHA-256 and pin it after independent Ubuntu qualification.'
