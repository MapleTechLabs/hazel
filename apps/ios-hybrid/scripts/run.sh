#!/usr/bin/env bash
# Generates the Xcode project, builds for the simulator and installs and launches the app.
#   SIM=<udid> bash scripts/run.sh     (default: the first booted iPhone)
set -euo pipefail
cd "$(dirname "$0")/.."

SIM="${SIM:-$(xcrun simctl list devices booted | grep -m1 -oE '[0-9A-F-]{36}')}"
xcodegen generate --quiet
xcodebuild -project HazelHybrid.xcodeproj -scheme HazelHybrid -configuration Debug \
	-destination "id=$SIM" -derivedDataPath build/derived CODE_SIGNING_ALLOWED=NO \
	${OFFLINE:+HAZEL_PAGE_ORIGIN=http://localhost} -quiet build
APP=build/derived/Build/Products/Debug-iphonesimulator/HazelHybrid.app
xcrun simctl install "$SIM" "$APP"
xcrun simctl launch "$SIM" sh.hazel.hybrid-spike
