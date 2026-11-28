#!/usr/bin/env bash
# Builds the native app (`Hazel/`) for iPhones, signed for the App Store as HazelChat (`hazel.app`),
# and uploads it to TestFlight with the `asc` CLI's stored credentials.
#   BUILD=3186.7 bash scripts/release.sh           (BUILD: above the app's latest TestFlight build)
#   PROFILE=… IDENTITY=… UPLOAD=0                  (defaults: ~/.asc/signing's App Store profile,
#                                                   "Apple Distribution", upload on)
#   DEMO=1 BUILD=… bash scripts/release.sh         (a demo: the offline fixture in-process, no server
#                                                   or account; `script/demo.ts`)
set -euo pipefail
cd "$(dirname "$0")/.."

BUILD="${BUILD:?BUILD is the build number, above the latest on TestFlight}"
VERSION="${VERSION:-0.1.0}"
BUNDLE_ID="${BUNDLE_ID:-hazel.app}"
PROFILE="${PROFILE:-$HOME/.asc/signing/hazel_appstore.mobileprovision}"
IDENTITY="${IDENTITY:-Apple Distribution}"
OUT=build/release

# The web build is online (production), whatever a simulator run left (`build/web.mode`); a demo's
# fallback pages are the offline web build, served from the app's own origin.
if [ "${DEMO:-0}" = "1" ]; then
	bun run build:web:offline >/dev/null
	echo offline >build/web.mode
	SCRIPT=build:hazel:demo
	PAGE_ORIGIN=http://localhost
else
	bun run build:web >/dev/null
	echo online >build/web.mode
	SCRIPT=build:hazel
	PAGE_ORIGIN=https://app.hazel.sh
fi
python3 scripts/fonts.py >/dev/null
# The app's script (the demo's, with the fixture) and the web's icons (`build-hazel.sh`).
bun run "$SCRIPT" >/dev/null
bun scripts/export-icons.ts build/icons/Icons.xcassets >/dev/null
xcodegen generate --quiet
rm -rf "$OUT" && mkdir -p "$OUT"
xcodebuild -project Hazel.xcodeproj -scheme Hazel -configuration Release \
	-destination 'generic/platform=iOS' -derivedDataPath build/derived-release \
	PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID" MARKETING_VERSION="$VERSION" CURRENT_PROJECT_VERSION="$BUILD" \
	CODE_SIGNING_ALLOWED=NO HAZEL_PAGE_ORIGIN="$PAGE_ORIGIN" -quiet build
APP="$OUT/Payload/Hazel.app"
mkdir -p "$OUT/Payload"
cp -R build/derived-release/Build/Products/Release-iphoneos/Hazel.app "$APP"

# Signed with what the profile grants: its team's identifier for this app.
cp "$PROFILE" "$APP/embedded.mobileprovision"
security cms -D -i "$PROFILE" > "$OUT/profile.plist"
TEAM=$(plutil -extract TeamIdentifier.0 raw -o - "$OUT/profile.plist")
GRANTED=$(plutil -extract Entitlements.application-identifier raw -o - "$OUT/profile.plist")
[ "$GRANTED" = "$TEAM.$BUNDLE_ID" ] || { echo "profile is for $GRANTED, not $TEAM.$BUNDLE_ID" >&2; exit 1; }
# Push (APNs): granted when the App ID has the Push Notifications capability; without it the app
# ships without push, as before (`PushNotifications.swift` then gets no token).
APS=$(plutil -extract Entitlements.aps-environment raw -o - "$OUT/profile.plist" 2>/dev/null || true)
[ -n "$APS" ] || echo "warning: the profile grants no aps-environment: push is off in this build" >&2
cat > "$OUT/entitlements.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
	<key>application-identifier</key><string>$TEAM.$BUNDLE_ID</string>
	<key>com.apple.developer.team-identifier</key><string>$TEAM</string>
	<key>get-task-allow</key><false/>
	<key>beta-reports-active</key><true/>
${APS:+<key>aps-environment</key><string>$APS</string>}
</dict></plist>
PLIST
codesign --sign "$IDENTITY" --entitlements "$OUT/entitlements.plist" --generate-entitlement-der --force "$APP"
codesign --verify --strict --verbose=2 "$APP"

(cd "$OUT" && zip -qry Hazel.ipa Payload)
echo "$OUT/Hazel.ipa  $BUNDLE_ID $VERSION ($BUILD)"
if [ "${UPLOAD:-1}" = "1" ]; then
	asc builds upload --app "$BUNDLE_ID" --ipa "$OUT/Hazel.ipa" --wait
fi
