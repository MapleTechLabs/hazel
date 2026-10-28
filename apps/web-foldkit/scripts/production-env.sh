# Production build env for the Foldkit app, shared by the web deploy and the desktop build.
# Source it: `. scripts/production-env.sh`. Values already set (CI repo vars) are kept.
export VITE_BACKEND_URL="${VITE_BACKEND_URL:-https://api.hazel.sh}"
export VITE_APP_URL="${VITE_APP_URL:-https://app.hazel.sh}"
export VITE_RIVET_URL="${VITE_RIVET_URL:-https://rivet.hazel.sh}"
export VITE_R2_PUBLIC_URL="${VITE_R2_PUBLIC_URL:-https://cdn.hazel.sh}"
export VITE_PUBLIC_POSTHOG_KEY="${VITE_PUBLIC_POSTHOG_KEY:-phc_ifs2nPyiiVDqk2c4cZO9uQwSertR5TFg19repUZLvfX}"
export VITE_PUBLIC_POSTHOG_HOST="${VITE_PUBLIC_POSTHOG_HOST:-https://ph.hazel.sh}"
export VITE_OTEL_ENVIRONMENT="${VITE_OTEL_ENVIRONMENT:-production}"
export VITE_COMMIT_SHA="${VITE_COMMIT_SHA:-$(git rev-parse HEAD)}"
