#!/usr/bin/env bash
# No downloaded shell is executed. Verify the approved binary before installation.
set -Eeuo pipefail
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || { echo 'ERROR=APPROVED_LINUX_AMD64_ONLY'; exit 1; }
EXPECTED='3732fbe8a6e9d2ea3925d02d0e3a1478bc1e01d742c2be75d3ea7300c46c45f0'
URL='https://github.com/argotorg/fe/releases/download/v26.5.0/fe_linux_amd64'
TMP="$(mktemp -d)"
trap 'rm -rf -- "$TMP"' EXIT
if ! curl --fail --location --silent --show-error \
    --connect-timeout 20 --max-time 180 --retry 5 --retry-delay 6 --retry-all-errors \
    "$URL" -o "$TMP/fe"; then
  echo 'FE_DIRECT_DOWNLOAD_FAILED_TRY_OFFICIAL_GITHUB_ASSET_API'
  curl --fail --location --silent --show-error \
    --connect-timeout 20 --max-time 180 --retry 5 --retry-delay 6 --retry-all-errors \
    -H 'Accept: application/octet-stream' \
    -H 'X-GitHub-Api-Version: 2022-11-28' \
    'https://api.github.com/repos/argotorg/fe/releases/assets/679295826' \
    -o "$TMP/fe"
fi
[ "$(stat -c '%s' "$TMP/fe")" = '54195184' ] || {
  echo 'ERROR=FE_OFFICIAL_ASSET_SIZE_MISMATCH'
  exit 1
}
echo "$EXPECTED  $TMP/fe" | sha256sum -c -
mkdir -p "$HOME/.fe/bin"
install -m 755 "$TMP/fe" "$HOME/.fe/bin/fe"
"$HOME/.fe/bin/fe" --version | grep -F 'fe 26.5.0 (3dab95f)'
echo 'FE_26_5_0_LINUX_INSTALL=PASS'
