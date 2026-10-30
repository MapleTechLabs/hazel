# Production build env for the Foldkit app, used by the desktop build.
# Source it: `. scripts/production-env.sh`. Values already set are kept.
export VITE_BACKEND_URL="${VITE_BACKEND_URL:-https://api.hazel.sh}"
export VITE_APP_URL="${VITE_APP_URL:-https://app.hazel.sh}"
export VITE_R2_PUBLIC_URL="${VITE_R2_PUBLIC_URL:-https://cdn.hazel.sh}"
