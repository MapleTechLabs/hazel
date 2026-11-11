#!/usr/bin/env bash
# The desktop app's frontend: the production build Tauri bundles (apps/desktop's beforeBuildCommand).
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/production-env.sh
rm -rf dist
bunx vite build
