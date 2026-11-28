#!/usr/bin/env bash
# Builds the Effect UI native-host spike (`effect-ui/`, `EffectUiSpike/`) for the simulator, no install:
#   build/derived/Build/Products/Debug-iphonesimulator/EffectUiSpike.app
set -euo pipefail
cd "$(dirname "$0")/.."
# EFFECT_UI_BUILD=build:effect-ui:live bundles the live-data entry (G3) instead of the demo.
bun run "${EFFECT_UI_BUILD:-build:effect-ui}" >/dev/null
# The hybrid target's folders, which the project spec requires to exist (left empty if unbuilt).
mkdir -p build/web build/fonts
bun scripts/export-icons.ts build/icons/Icons.xcassets >/dev/null
python3 scripts/fonts.py >/dev/null
xcodegen generate --quiet
xcodebuild -project Hazel.xcodeproj -scheme EffectUiSpike -configuration Debug \
	-destination 'generic/platform=iOS Simulator' -derivedDataPath build/derived CODE_SIGNING_ALLOWED=NO \
	-quiet build
