#!/usr/bin/env bash
# Bundles the G7 bench (`packages/ui/src/bench/entry.ts`) for JavaScriptCore, into the test resources
# and the Bench app's resources.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../../.." && pwd)"
mkdir -p "$here/build" "$here/../Tests/HazelUITests/JS"
cd "$root/packages/ui"
bun build src/bench/entry.ts --target=browser --format=iife --minify --outfile="$here/build/g7bench.js" >/dev/null
cp "$here/build/g7bench.js" "$here/../Tests/HazelUITests/JS/g7bench.js"
echo "g7bench.js $(wc -c < "$here/build/g7bench.js") bytes"
