/**
 * Builds Hazel for iOS: the Rune shell (`host/ios`), the runtime bundled for its web worker
 * (`scripts/build-ios.ts`) and the web app's public assets.
 *
 *   bun run ios [--install <udid>]     dist/ios/Hazel.app for the Simulator, ad-hoc signed;
 *                                      `--install` installs it (`booted` for the running one)
 *   bun run ios --release [--upload]   dist/ios/Hazel.ipa for iPhones, signed for the App Store,
 *                                      live against production; `--upload` sends it to TestFlight
 *
 * A release build needs `HAZEL_IOS_PROFILE`, an App Store provisioning profile for its bundle ID
 * (`HAZEL_IOS_BUNDLE_ID`, `hazel.app` by default: App Store Connect's HazelChat), and the profile's
 * Apple Distribution certificate in the keychain (`HAZEL_IOS_IDENTITY` picks another identity).
 * Its version is `HAZEL_IOS_VERSION` (0.1.0), its build number `HAZEL_IOS_BUILD` (the commit
 * count, which only grows on main). `--upload` uses the `asc` CLI's stored credentials.
 */
import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs"

const root = new URL("..", import.meta.url).pathname
const release = process.argv.includes("--release")
const target = release ? "aarch64-apple-ios" : "aarch64-apple-ios-sim"
const out = `${root}dist/ios`
const app = `${out}/Hazel.app`
// The simulator's executable carries its entitlements for this ID (`host/ios/build.rs`).
const bundleId = release ? process.env.HAZEL_IOS_BUNDLE_ID || "hazel.app" : "sh.hazel.ios"
const minimumOS = "17.0"

const run = (command: string, args: Array<string>, options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) =>
	execFileSync(command, args, { cwd: options.cwd ?? root, stdio: "inherit", env: options.env })
const read = (command: string, args: Array<string>) =>
	execFileSync(command, args, { cwd: root, encoding: "utf8" }).trim()

const profile = release ? process.env.HAZEL_IOS_PROFILE : undefined
if (release && !profile) throw new Error("--release needs HAZEL_IOS_PROFILE (an App Store .mobileprovision)")

run("bun", ["scripts/build-ios.ts"])
run("cargo", ["build", "--release", "-p", "hazel-ios", "--target", target], {
	cwd: `${root}host`,
	env: { ...process.env, IPHONEOS_DEPLOYMENT_TARGET: minimumOS },
})

// `dist/ios/runtime.js` is the bundle just built; everything else here is this build's output.
for (const path of [app, `${out}/build`, `${out}/Payload`, `${out}/Hazel.ipa`])
	rmSync(path, { recursive: true, force: true })
mkdirSync(app, { recursive: true })
cpSync(`${root}host/target/${target}/release/hazel-ios`, `${app}/hazel-ios`)
cpSync(`${out}/runtime.js`, `${app}/runtime.js`)
// What the runtime reads from `process.env`. A simulator build is offline unless `HAZEL_DATA=live`
// was set when building; a release build is live against production (`scripts/bundle.ts`'s origins).
const environment: Record<string, string> = release
	? {
			HAZEL_DATA: "live",
			VITE_BACKEND_URL: process.env.HAZEL_BACKEND_URL || "https://api.hazel.sh",
			VITE_APP_URL: process.env.HAZEL_APP_URL || "https://app.hazel.sh",
			VITE_R2_PUBLIC_URL: process.env.HAZEL_R2_PUBLIC_URL || "https://cdn.hazel.sh",
		}
	: Object.fromEntries(
			["HAZEL_DATA", "VITE_BACKEND_URL", "VITE_APP_URL", "NATIVE_DEBUG", "NATIVE_PATH"].flatMap(
				(name) => {
					const value = process.env[name]
					return value === undefined ? [] : [[name, value]]
				},
			),
		)
writeFileSync(`${app}/environment.json`, JSON.stringify(environment))
cpSync(`${root}../web-foldkit/public`, `${app}/public`, { recursive: true })

const info: Record<string, unknown> = {
	CFBundleExecutable: "hazel-ios",
	CFBundleIdentifier: bundleId,
	CFBundleName: "Hazel",
	CFBundleDisplayName: "Hazel",
	CFBundlePackageType: "APPL",
	CFBundleInfoDictionaryVersion: "6.0",
	CFBundleVersion: "1",
	CFBundleShortVersionString: "0.1",
	MinimumOSVersion: minimumOS,
	CFBundleSupportedPlatforms: ["iPhoneSimulator"],
	UIDeviceFamily: [1, 2],
	UILaunchScreen: {},
	// Motion may run above 60 Hz on a ProMotion iPhone (Rune's display link asks for 120).
	CADisableMinimumFrameDurationOnPhone: true,
	UIRequiredDeviceCapabilities: ["arm64"],
}
// A dev stack on this Mac (http://localhost); everything else is HTTPS.
if ((environment.VITE_BACKEND_URL ?? "http://").startsWith("http://"))
	info.NSAppTransportSecurity = { NSAllowsLocalNetworking: true }

if (release) {
	const version = process.env.HAZEL_IOS_VERSION || "0.1.0"
	const build = process.env.HAZEL_IOS_BUILD || read("git", ["rev-list", "--count", "HEAD"])
	const sdk = (flag: string) => read("xcrun", ["--sdk", "iphoneos", flag])
	const [, xcodeVersion = "", xcodeBuild = ""] =
		/Xcode (\S+)\s+Build version (\S+)/.exec(read("xcodebuild", ["-version"])) ?? []
	const [major = "0", minor = "0", patch = "0"] = xcodeVersion.split(".")
	Object.assign(info, {
		CFBundleVersion: build,
		CFBundleShortVersionString: version,
		CFBundleSupportedPlatforms: ["iPhoneOS"],
		LSRequiresIPhoneOS: true,
		// iPhone only: an iPad app must support every orientation and multitasking.
		UIDeviceFamily: [1],
		UISupportedInterfaceOrientations: ["UIInterfaceOrientationPortrait"],
		// Only HTTPS, which is exempt: no export compliance question per build.
		ITSAppUsesNonExemptEncryption: false,
		// What App Store validation reads to know the SDK and toolchain, as Xcode writes them.
		DTPlatformName: "iphoneos",
		DTPlatformVersion: sdk("--show-sdk-platform-version"),
		DTPlatformBuild: sdk("--show-sdk-build-version"),
		DTSDKName: `iphoneos${sdk("--show-sdk-version")}`,
		DTSDKBuild: sdk("--show-sdk-build-version"),
		DTXcode: `${major.padStart(2, "0")}${minor}${patch}`,
		DTXcodeBuild: xcodeBuild,
		DTCompiler: "com.apple.compilers.llvm.clang.1_0",
		BuildMachineOSBuild: read("sw_vers", ["-buildVersion"]),
	})

	// The icon: an asset catalog compiled to Assets.car, with the plist keys that name it.
	const catalog = `${out}/build/Assets.xcassets`
	mkdirSync(`${catalog}/AppIcon.appiconset`, { recursive: true })
	writeFileSync(`${catalog}/Contents.json`, JSON.stringify({ info: { author: "xcode", version: 1 } }))
	cpSync(`${root}host/ios/assets/AppIcon.png`, `${catalog}/AppIcon.appiconset/AppIcon.png`)
	writeFileSync(
		`${catalog}/AppIcon.appiconset/Contents.json`,
		JSON.stringify({
			images: [{ filename: "AppIcon.png", idiom: "universal", platform: "ios", size: "1024x1024" }],
			info: { author: "xcode", version: 1 },
		}),
	)
	const partial = `${out}/build/assets.plist`
	run("xcrun", [
		"actool",
		catalog,
		"--compile",
		app,
		"--platform",
		"iphoneos",
		"--minimum-deployment-target",
		minimumOS,
		"--target-device",
		"iphone",
		"--app-icon",
		"AppIcon",
		"--output-partial-info-plist",
		partial,
		"--output-format",
		"human-readable-text",
	])
	Object.assign(info, JSON.parse(read("plutil", ["-convert", "json", "-o", "-", partial])))
	cpSync(`${root}host/ios/PrivacyInfo.xcprivacy`, `${app}/PrivacyInfo.xcprivacy`)
}

const infoJson = `${out}/build/Info.json`
mkdirSync(`${out}/build`, { recursive: true })
writeFileSync(infoJson, JSON.stringify(info))
run("plutil", ["-convert", "xml1", "-o", `${app}/Info.plist`, infoJson])

if (!release) {
	run("codesign", ["--sign", "-", "--force", app])
	const install = process.argv.indexOf("--install")
	if (install !== -1) run("xcrun", ["simctl", "install", process.argv[install + 1] ?? "booted", app])
	process.stdout.write(`${app}\n`)
	process.exit(0)
}

// Signed for the App Store with what the profile grants: its team's identifier for this app, and
// the app's own keychain group (the sign-in vault, `hazel_native::sign_in`).
// SAFETY: `release` checked `profile` above.
cpSync(profile!, `${app}/embedded.mobileprovision`)
const decoded = `${out}/build/profile.plist`
writeFileSync(decoded, execFileSync("security", ["cms", "-D", "-i", profile!]))
const team = read("plutil", ["-extract", "TeamIdentifier.0", "raw", "-o", "-", decoded])
const granted = read("plutil", ["-extract", "Entitlements.application-identifier", "raw", "-o", "-", decoded])
const appId = `${team}.${bundleId}`
if (granted !== appId) throw new Error(`HAZEL_IOS_PROFILE is for ${granted}, not ${appId}`)
const entitlements = `${out}/build/entitlements.plist`
writeFileSync(
	`${out}/build/entitlements.json`,
	JSON.stringify({
		"application-identifier": appId,
		"com.apple.developer.team-identifier": team,
		"keychain-access-groups": [appId],
		"get-task-allow": false,
		"beta-reports-active": true,
	}),
)
run("plutil", ["-convert", "xml1", "-o", entitlements, `${out}/build/entitlements.json`])
run("codesign", [
	"--sign",
	process.env.HAZEL_IOS_IDENTITY || "Apple Distribution",
	"--entitlements",
	entitlements,
	"--generate-entitlement-der",
	"--force",
	app,
])
run("codesign", ["--verify", "--strict", "--verbose=2", app])

mkdirSync(`${out}/Payload`)
cpSync(app, `${out}/Payload/Hazel.app`, { recursive: true, verbatimSymlinks: true })
const ipa = `${out}/Hazel.ipa`
run("zip", ["-qry", ipa, "Payload"], { cwd: out })
rmSync(`${out}/Payload`, { recursive: true, force: true })
process.stdout.write(`${ipa}\n  ${bundleId} ${info.CFBundleShortVersionString} (${info.CFBundleVersion})\n`)

if (process.argv.includes("--upload"))
	run("asc", ["builds", "upload", "--app", process.env.HAZEL_ASC_APP || bundleId, "--ipa", ipa, "--wait"])
