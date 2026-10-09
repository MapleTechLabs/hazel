#!/usr/bin/env bash
# Builds with the production env legacy app.hazel.sh used and publishes to the hazel-app Worker.
set -euo pipefail
cd "$(dirname "$0")/.."
export VITE_BACKEND_URL=https://api.hazel.sh
export VITE_ELECTRIC_URL=https://electric.hazel.sh/v1/shape
export VITE_RIVET_URL=https://rivet.hazel.sh
export VITE_R2_PUBLIC_URL=https://cdn.hazel.sh
export VITE_CLERK_PUBLISHABLE_KEY=pk_live_Y2xlcmsuaGF6ZWwuc2gk
export VITE_PUBLIC_POSTHOG_KEY=phc_ifs2nPyiiVDqk2c4cZO9uQwSertR5TFg19repUZLvfX
export VITE_PUBLIC_POSTHOG_HOST=https://ph.hazel.sh
export VITE_OTEL_ENVIRONMENT=production
export VITE_COMMIT_SHA="$(git rev-parse HEAD)"
rm -rf dist
bunx vite build
bunx wrangler deploy --message "web-foldkit $(git rev-parse --short HEAD)"
