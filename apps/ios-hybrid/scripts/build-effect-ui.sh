#!/usr/bin/env bash
# Builds the Effect UI native-host spike (`effect-ui/`, `EffectUiSpike/`) for the simulator, no install:
#   build/derived/Build/Products/Debug-iphonesimulator/EffectUiSpike.app
set -euo pipefail
cd "$(dirname "$0")/.."
bun run build:effect-ui >/dev/null
# The hybrid target's folders, which the project spec requires to exist (left empty if unbuilt).
mkdir -p build/web build/fonts
xcodegen generate --quiet
xcodebuild -project HazelHybrid.xcodeproj -scheme EffectUiSpike -configuration Debug \
	-destination 'generic/platform=iOS Simulator' -derivedDataPath build/derived CODE_SIGNING_ALLOWED=NO \
	-quiet build
