#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")"
node p09/full-gate.mjs
