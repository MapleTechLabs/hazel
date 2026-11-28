#!/usr/bin/env bash
# Builds the native app (`Hazel/`, `hazel/`) for the simulator, no install:
#   build/derived/Build/Products/Debug-iphonesimulator/Hazel.app
#   OFFLINE=1 bash scripts/build-hazel.sh   (the fallback's web build against the offline fixture)
set -euo pipefail
cd "$(dirname "$0")/.."
bun run build:hazel >/dev/null
# The fallback's web build, only when missing or built for the other mode (it is the slow step).
mode="${OFFLINE:+offline}"
if [ ! -f build/web/index.html ] || [ "$(cat build/web.mode 2>/dev/null)" != "${mode:-online}" ]; then
	bun run "build:web${OFFLINE:+:offline}" >/dev/null
	echo "${mode:-online}" >build/web.mode
fi
mkdir -p build/effect-ui build/fonts
bun scripts/export-icons.ts build/icons/Icons.xcassets >/dev/null
python3 scripts/fonts.py >/dev/null
xcodegen generate --quiet
xcodebuild -project HazelHybrid.xcodeproj -scheme Hazel -configuration Debug \
	-destination 'generic/platform=iOS Simulator' -derivedDataPath build/derived CODE_SIGNING_ALLOWED=NO \
	${OFFLINE:+HAZEL_PAGE_ORIGIN=http://localhost} -quiet build
