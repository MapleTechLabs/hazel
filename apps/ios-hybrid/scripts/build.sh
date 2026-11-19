#!/usr/bin/env bash
# Builds the web bundle and the simulator app (no install): build/derived/…/HazelHybrid.app
#   OFFLINE=1 bash scripts/build.sh     (the offline fixture instead of production)
set -euo pipefail
cd "$(dirname "$0")/.."
bun run "build:web${OFFLINE:+:offline}" >/dev/null
python3 scripts/fonts.py >/dev/null
xcodegen generate --quiet
xcodebuild -project HazelHybrid.xcodeproj -scheme HazelHybrid -configuration Debug \
	-destination 'generic/platform=iOS Simulator' -derivedDataPath build/derived CODE_SIGNING_ALLOWED=NO \
	${OFFLINE:+HAZEL_PAGE_ORIGIN=http://localhost} -quiet build
