#!/usr/bin/env bash
# Builds the app for iPhones, signed for the App Store as HazelChat (`hazel.app`), and uploads it
# to TestFlight with the `asc` CLI's stored credentials.
#   BUILD=3126.1 bash scripts/release.sh           (BUILD: above the app's latest TestFlight build)
#   PROFILE=… IDENTITY=… UPLOAD=0                  (defaults: ~/.asc/signing's App Store profile,
#                                                   "Apple Distribution", upload on)
set -euo pipefail
cd "$(dirname "$0")/.."

BUILD="${BUILD:?BUILD is the build number, above the latest on TestFlight}"
VERSION="${VERSION:-0.1.0}"
BUNDLE_ID="${BUNDLE_ID:-hazel.app}"
PROFILE="${PROFILE:-$HOME/.asc/signing/hazel_appstore.mobileprovision}"
IDENTITY="${IDENTITY:-Apple Distribution}"
OUT=build/release

bun run build:web >/dev/null
python3 scripts/fonts.py >/dev/null
xcodegen generate --quiet
rm -rf "$OUT" && mkdir -p "$OUT"
xcodebuild -project HazelHybrid.xcodeproj -scheme HazelHybrid -configuration Release \
	-destination 'generic/platform=iOS' -derivedDataPath build/derived-release \
	PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID" MARKETING_VERSION="$VERSION" CURRENT_PROJECT_VERSION="$BUILD" \
	CODE_SIGNING_ALLOWED=NO -quiet build
APP="$OUT/Payload/HazelHybrid.app"
mkdir -p "$OUT/Payload"
cp -R build/derived-release/Build/Products/Release-iphoneos/HazelHybrid.app "$APP"

# Signed with what the profile grants: its team's identifier for this app.
cp "$PROFILE" "$APP/embedded.mobileprovision"
security cms -D -i "$PROFILE" > "$OUT/profile.plist"
TEAM=$(plutil -extract TeamIdentifier.0 raw -o - "$OUT/profile.plist")
GRANTED=$(plutil -extract Entitlements.application-identifier raw -o - "$OUT/profile.plist")
[ "$GRANTED" = "$TEAM.$BUNDLE_ID" ] || { echo "profile is for $GRANTED, not $TEAM.$BUNDLE_ID" >&2; exit 1; }
cat > "$OUT/entitlements.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
	<key>application-identifier</key><string>$TEAM.$BUNDLE_ID</string>
	<key>com.apple.developer.team-identifier</key><string>$TEAM</string>
	<key>get-task-allow</key><false/>
	<key>beta-reports-active</key><true/>
</dict></plist>
PLIST
codesign --sign "$IDENTITY" --entitlements "$OUT/entitlements.plist" --generate-entitlement-der --force "$APP"
codesign --verify --strict --verbose=2 "$APP"

(cd "$OUT" && zip -qry Hazel.ipa Payload)
echo "$OUT/Hazel.ipa  $BUNDLE_ID $VERSION ($BUILD)"
if [ "${UPLOAD:-1}" = "1" ]; then
	asc builds upload --app "$BUNDLE_ID" --ipa "$OUT/Hazel.ipa" --wait
fi
