/**
 * Builds Hazel for the iOS Simulator (dist/ios/Hazel.app): the Rune shell (`host/ios`), the
 * runtime bundled for its web worker (`scripts/build-ios.ts`) and the web app's public assets,
 * ad-hoc signed. `--install <udid>` installs it on that simulator (`booted` for the running one).
 */
import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs"

const root = new URL("..", import.meta.url).pathname
const target = "aarch64-apple-ios-sim"
const app = `${root}dist/ios/Hazel.app`
const bundleId = "sh.hazel.ios"

const run = (command: string, args: Array<string>, cwd = root) =>
	execFileSync(command, args, { cwd, stdio: "inherit" })

run("bun", ["scripts/build-ios.ts"])
run("cargo", ["build", "--release", "-p", "hazel-ios", "--target", target], `${root}host`)

rmSync(app, { recursive: true, force: true })
mkdirSync(app, { recursive: true })
cpSync(`${root}host/target/${target}/release/hazel-ios`, `${app}/hazel-ios`)
cpSync(`${root}dist/ios/runtime.js`, `${app}/runtime.js`)
// What the runtime reads from `process.env`: offline unless `HAZEL_DATA=live` was set when building.
const environment = Object.fromEntries(
	["HAZEL_DATA", "VITE_BACKEND_URL", "NATIVE_DEBUG", "NATIVE_PATH"].flatMap((name) => {
		const value = process.env[name]
		return value === undefined ? [] : [[name, value]]
	}),
)
writeFileSync(`${app}/environment.json`, JSON.stringify(environment))
cpSync(`${root}../web-foldkit/public`, `${app}/public`, { recursive: true })
writeFileSync(
	`${app}/Info.plist`,
	`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleExecutable</key>
	<string>hazel-ios</string>
	<key>CFBundleIdentifier</key>
	<string>${bundleId}</string>
	<key>CFBundleName</key>
	<string>Hazel</string>
	<key>CFBundleDisplayName</key>
	<string>Hazel</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleVersion</key>
	<string>1</string>
	<key>CFBundleShortVersionString</key>
	<string>0.1</string>
	<key>MinimumOSVersion</key>
	<string>17.0</string>
	<key>CFBundleSupportedPlatforms</key>
	<array>
		<string>iPhoneSimulator</string>
	</array>
	<key>UIDeviceFamily</key>
	<array>
		<integer>1</integer>
		<integer>2</integer>
	</array>
	<key>UILaunchScreen</key>
	<dict/>
	<key>UIRequiredDeviceCapabilities</key>
	<array>
		<string>arm64</string>
	</array>
</dict>
</plist>
`,
)
run("codesign", ["--sign", "-", "--force", app])

const install = process.argv.indexOf("--install")
if (install !== -1) run("xcrun", ["simctl", "install", process.argv[install + 1] ?? "booted", app])
process.stdout.write(`${app}\n`)
