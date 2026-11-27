#!/usr/bin/env bash
# Builds the G7 bench app for the simulator, no install:
#   build/derived/Build/Products/Release-iphonesimulator/HazelUIBench.app
set -euo pipefail
cd "$(dirname "$0")"
./build-js.sh
xcodegen generate --quiet
xcodebuild -project HazelUIBench.xcodeproj -scheme HazelUIBench -configuration "${CONFIG:-Release}" \
	-destination 'generic/platform=iOS Simulator' -derivedDataPath build/derived CODE_SIGNING_ALLOWED=NO \
	-quiet build
