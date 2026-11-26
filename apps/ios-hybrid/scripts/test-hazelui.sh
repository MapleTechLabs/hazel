#!/usr/bin/env bash
# HazelUI's tests on the pinned simulator (phase 1.5):
#   bun run --cwd apps/ios-hybrid test:hazelui [S0|S1|S2|S3|S4|S5|F]
# No lane runs everything. A lane runs its own tests; snapshots only for the tags it owns.
# HAZELUI_RECORD=1 writes snapshot references (Tests/HazelUITests/__snapshots__) instead of comparing.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
lane="${1:-}"
# Override per parallel lane (same device type and runtime, so snapshots match): HAZELUI_SIM=hazel-ui-s1
SIM_NAME="${HAZELUI_SIM:-hazel-ui-ci}"
SIM_TYPE="com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro"
SIM_RUNTIME="com.apple.CoreSimulator.SimRuntime.iOS-26-4"

# The pinned simulator: iPhone 17 Pro on iOS 26.4, created when missing.
udid="$(xcrun simctl list devices -j | python3 -c "
import json, sys
devices = json.load(sys.stdin)['devices'].get('$SIM_RUNTIME', [])
print(next((d['udid'] for d in devices if d['name'] == '$SIM_NAME' and d['isAvailable']), ''))")"
if [ -z "$udid" ]; then
	udid="$(xcrun simctl create "$SIM_NAME" "$SIM_TYPE" "$SIM_RUNTIME")"
	echo "created $SIM_NAME ($udid)"
fi

only=()
case "$lane" in
	"") ;;
	S0) only=(-only-testing:HazelUITests/GoldenTests -only-testing:HazelUITests/RedrawTests -only-testing:HazelUITests/SnapshotTests) ;;
	S1 | S2 | S3 | S4) only=(-only-testing:HazelUITests/SnapshotTests) ;;
	S5) only=(-only-testing:HazelUITests/SnapshotTests -only-testing:HazelUITests/G7Tests) ;;
	F) ;;
	*) echo "unknown lane $lane (S0 to S5, F, or none)" >&2; exit 2 ;;
esac

bash "$here/HazelUI/Bench/build-js.sh" >/dev/null
cd "$here/HazelUI"
mkdir -p .build
log=".build/test-hazelui.log"
action=test
# Lane F owns HazelUI/Runtime: it has no tests of its own yet, so it compiles the package and its tests.
[ "$lane" = "F" ] && action=build-for-testing
status=0
TEST_RUNNER_HAZELUI_LANES="${lane#F}" TEST_RUNNER_HAZELUI_RECORD="${HAZELUI_RECORD:-}" \
	xcodebuild "$action" -scheme HazelUI -destination "platform=iOS Simulator,id=$udid" \
	-derivedDataPath .build/xcode "${only[@]+"${only[@]}"}" >"$log" 2>&1 || status=$?
grep -E "HAZELUI_SNAPSHOT|error:|failed|Executed|passed after|\*\* (TEST|BUILD)" "$log" | grep -v "^\s*$" | tail -60 || true
[ "$status" -eq 0 ] || echo "xcodebuild exited $status; full log: apps/ios-hybrid/HazelUI/$log"
exit "$status"
