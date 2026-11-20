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
 *
 * When the profile grants Communication Notifications (the App ID's capability), the app is signed
 * with it, and a notification from a person shows their picture in place of the app's icon
 * (`host/src/notify.rs`); otherwise the picture shows beside the text. The simulator always has it
 * (`host/ios/build.rs`).
 *
 * Pushes get the same through the app's Notification Service Extension
 * (`host/ios/notification-service`, built with `swiftc` into `PlugIns/NotificationService.appex`).
 * A release signs it with `HAZEL_IOS_EXTENSION_PROFILE`, an App Store profile for
 * `<bundle ID>.NotificationService` (with Communication Notifications for the picture as the icon);
 * without one the release ships without the extension, and pushes show no picture.
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
/**
 * The APNs host this build's device tokens belong to: the simulator's executable embeds
 * `development` (`host/ios/build.rs`), a release is signed with `production`. The runtime sends it
 * with the token (`src/push.ts`).
 */
const apsEnvironment = release ? "production" : "development"

const run = (command: string, args: Array<string>, options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) =>
	execFileSync(command, args, { cwd: options.cwd ?? root, stdio: "inherit", env: options.env })
const read = (command: string, args: Array<string>) =>
	execFileSync(command, args, { cwd: root, encoding: "utf8" }).trim()

const profile = release ? process.env.HAZEL_IOS_PROFILE : undefined
if (release && !profile) throw new Error("--release needs HAZEL_IOS_PROFILE (an App Store .mobileprovision)")

/** The Notification Service Extension: its bundle, its ID, and its profile for a release. */
const extensionName = "NotificationService"
const extensionId = `${bundleId}.${extensionName}`
const extensionBundle = `${app}/PlugIns/${extensionName}.appex`
const extensionProfile = release ? process.env.HAZEL_IOS_EXTENSION_PROFILE || undefined : undefined
/** A release without the extension's profile ships without it (pushes show no picture). */
const withExtension = !release || extensionProfile !== undefined
if (!withExtension)
	process.stderr.write(
		`warning: HAZEL_IOS_EXTENSION_PROFILE is not set: building without the notification service ` +
			`(an App Store profile for ${extensionId}), so pushes show no sender picture\n`,
	)

const communicationEntitlement = "com.apple.developer.usernotifications.communication"
/** Whether `profilePath` grants Communication Notifications (a simulator build always has it). */
const grantsCommunication = (profilePath: string | undefined) =>
	profilePath === undefined ||
	(() => {
		try {
			const decoded = execFileSync("security", ["cms", "-D", "-i", profilePath])
			return (
				execFileSync(
					"plutil",
					[
						"-extract",
						`Entitlements.${communicationEntitlement.replaceAll(".", "\\.")}`,
						"raw",
						"-o",
						"-",
						"-",
					],
					{ input: decoded, encoding: "utf8" },
				).trim() === "true"
			)
		} catch {
			return false
		}
	})()
/** Whether this build carries the Communication Notifications entitlement. */
const communication = grantsCommunication(profile)
const extensionCommunication = grantsCommunication(extensionProfile)

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

// The notification service: Swift, linked as an app extension (its entry point is Foundation's
// `NSExtensionMain`). The simulator takes its entitlements from its executable, as the app does.
if (withExtension) {
	mkdirSync(extensionBundle, { recursive: true })
	const sdkName = release ? "iphoneos" : "iphonesimulator"
	const simulatorEntitlements = `${out}/build/extension-simulator.entitlements`
	if (!release) {
		mkdirSync(`${out}/build`, { recursive: true })
		writeFileSync(
			`${out}/build/extension-simulator.json`,
			JSON.stringify({
				"application-identifier": `HAZELSIM00.${extensionId}`,
				[communicationEntitlement]: true,
			}),
		)
		run("plutil", [
			"-convert",
			"xml1",
			"-o",
			simulatorEntitlements,
			`${out}/build/extension-simulator.json`,
		])
	}
	run("xcrun", [
		"--sdk",
		sdkName,
		"swiftc",
		"-target",
		release ? `arm64-apple-ios${minimumOS}` : `arm64-apple-ios${minimumOS}-simulator`,
		"-sdk",
		read("xcrun", ["--sdk", sdkName, "--show-sdk-path"]),
		"-O",
		"-swift-version",
		"5",
		"-parse-as-library",
		"-application-extension",
		"-module-name",
		extensionName,
		"-Xlinker",
		"-e",
		"-Xlinker",
		"_NSExtensionMain",
		...(release
			? []
			: [
					"-Xlinker",
					"-sectcreate",
					"-Xlinker",
					"__TEXT",
					"-Xlinker",
					"__entitlements",
					"-Xlinker",
					simulatorEntitlements,
				]),
		"-o",
		`${extensionBundle}/${extensionName}`,
		`${root}host/ios/notification-service/NotificationService.swift`,
	])
}
cpSync(`${out}/runtime.js`, `${app}/runtime.js`)
// What the runtime reads from `process.env`. A simulator build is offline unless `HAZEL_DATA=live`
// was set when building; a release build is live against production (`scripts/bundle.ts`'s origins).
// Both offer the app's notifications (the permission pushes need) and name their APNs host.
const platformEnvironment = { HAZEL_NOTIFICATIONS: "1", HAZEL_APNS_ENV: apsEnvironment }
const environment: Record<string, string> = release
	? {
			...platformEnvironment,
			HAZEL_DATA: "live",
			VITE_BACKEND_URL: process.env.HAZEL_BACKEND_URL || "https://api.hazel.sh",
			VITE_APP_URL: process.env.HAZEL_APP_URL || "https://app.hazel.sh",
			VITE_R2_PUBLIC_URL: process.env.HAZEL_R2_PUBLIC_URL || "https://cdn.hazel.sh",
		}
	: Object.fromEntries(
			[
				"HAZEL_DATA",
				"VITE_BACKEND_URL",
				"VITE_APP_URL",
				"NATIVE_DEBUG",
				"NATIVE_STATS",
				"NATIVE_PATH",
				"HAZEL_ISLANDS",
				"HAZEL_FIXTURE_HTML",
				// A session bearer for a live run against a stack without OAuth (a PR preview's
				// `dev:sign-in`); simulator builds only, it is written into the bundle as is.
				"HAZEL_SESSION_TOKEN",
			]
				.flatMap((name) => {
					const value = process.env[name]
					return value === undefined ? [] : [[name, value]]
				})
				.concat(Object.entries(platformEnvironment)),
		)
writeFileSync(`${app}/environment.json`, JSON.stringify(environment))
cpSync(`${root}../web-foldkit/public`, `${app}/public`, { recursive: true })

/** The app's Info.plist, as JSON for `plutil`: Apple's keys, and what the asset catalog adds. */
const info = {
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
	// Notifications from a person are messages from them (`host/src/notify.rs`).
	NSUserActivityTypes: ["INSendMessageIntent"],
	HazelCommunicationNotifications: communication,
} satisfies Record<string, unknown>
// A dev stack on this Mac (http://localhost); everything else is HTTPS.
if ((environment.VITE_BACKEND_URL ?? "http://").startsWith("http://"))
	Object.assign(info, { NSAppTransportSecurity: { NSAllowsLocalNetworking: true } })

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

if (withExtension) {
	// The app's version, platform and SDK keys (`DT*`, a release's), and what makes it a
	// notification service. The app's own keys (executable, icon, launch screen) are not the extension's.
	const sharedKeys = new Set([
		"CFBundleInfoDictionaryVersion",
		"CFBundleVersion",
		"CFBundleShortVersionString",
		"CFBundleSupportedPlatforms",
		"MinimumOSVersion",
		"UIDeviceFamily",
		// App Store validation refuses a 64-bit extension without `arm64` here.
		"UIRequiredDeviceCapabilities",
		"NSUserActivityTypes",
		"BuildMachineOSBuild",
	])
	const extensionInfo = {
		...Object.fromEntries(
			Object.entries(info).filter(([key]) => sharedKeys.has(key) || key.startsWith("DT")),
		),
		CFBundleExecutable: extensionName,
		CFBundleIdentifier: extensionId,
		CFBundleName: extensionName,
		CFBundleDisplayName: "Hazel Notifications",
		CFBundlePackageType: "XPC!",
		HazelCommunicationNotifications: extensionCommunication,
		NSExtension: {
			NSExtensionPointIdentifier: "com.apple.usernotifications.service",
			NSExtensionPrincipalClass: "NotificationService",
		},
	}
	writeFileSync(`${out}/build/extension-info.json`, JSON.stringify(extensionInfo))
	run("plutil", [
		"-convert",
		"xml1",
		"-o",
		`${extensionBundle}/Info.plist`,
		`${out}/build/extension-info.json`,
	])
}

if (!release) {
	// Inside out: the extension's signature first, then the app's, which seals it.
	if (withExtension) run("codesign", ["--sign", "-", "--force", extensionBundle])
	run("codesign", ["--sign", "-", "--force", app])
	const install = process.argv.indexOf("--install")
	if (install !== -1) run("xcrun", ["simctl", "install", process.argv[install + 1] ?? "booted", app])
	process.stdout.write(`${app}\n`)
	process.exit(0)
}

// Signed for the App Store with what the profile grants: its team's identifier for this app, and
// the app's own keychain group (the sign-in vault, `hazel_native::sign_in`).
if (profile === undefined)
	throw new Error("--release needs HAZEL_IOS_PROFILE (an App Store .mobileprovision)")
cpSync(profile, `${app}/embedded.mobileprovision`)
const decoded = `${out}/build/profile.plist`
writeFileSync(decoded, execFileSync("security", ["cms", "-D", "-i", profile]))
const team = read("plutil", ["-extract", "TeamIdentifier.0", "raw", "-o", "-", decoded])
const granted = read("plutil", ["-extract", "Entitlements.application-identifier", "raw", "-o", "-", decoded])
const appId = `${team}.${bundleId}`
if (granted !== appId) throw new Error(`HAZEL_IOS_PROFILE is for ${granted}, not ${appId}`)
// Pushes need the profile to grant them (the App ID's Push Notifications capability); a build
// signed without the grant installs, but APNs never hands it a token.
const grantedAps = (() => {
	try {
		return read("plutil", ["-extract", "Entitlements.aps-environment", "raw", "-o", "-", decoded])
	} catch {
		return undefined
	}
})()
if (grantedAps !== apsEnvironment)
	throw new Error(
		`HAZEL_IOS_PROFILE grants aps-environment ${grantedAps ?? "(none)"}, not ${apsEnvironment}: ` +
			"enable Push Notifications for the App ID and download the profile again",
	)
const entitlements = `${out}/build/entitlements.plist`
const entitlementValues = {
	"application-identifier": appId,
	"com.apple.developer.team-identifier": team,
	"keychain-access-groups": [appId],
	"aps-environment": apsEnvironment,
	"get-task-allow": false,
	"beta-reports-active": true,
}
writeFileSync(
	`${out}/build/entitlements.json`,
	JSON.stringify(
		communication ? { ...entitlementValues, [communicationEntitlement]: true } : entitlementValues,
	),
)
run("plutil", ["-convert", "xml1", "-o", entitlements, `${out}/build/entitlements.json`])

// The extension first: its own profile, for its own ID, from the same team.
if (extensionProfile !== undefined) {
	cpSync(extensionProfile, `${extensionBundle}/embedded.mobileprovision`)
	const extensionDecoded = `${out}/build/extension-profile.plist`
	writeFileSync(extensionDecoded, execFileSync("security", ["cms", "-D", "-i", extensionProfile]))
	const extensionAppId = `${team}.${extensionId}`
	const extensionGranted = read("plutil", [
		"-extract",
		"Entitlements.application-identifier",
		"raw",
		"-o",
		"-",
		extensionDecoded,
	])
	if (extensionGranted !== extensionAppId)
		throw new Error(`HAZEL_IOS_EXTENSION_PROFILE is for ${extensionGranted}, not ${extensionAppId}`)
	const extensionEntitlements = `${out}/build/extension-entitlements.plist`
	const extensionEntitlementValues = {
		"application-identifier": extensionAppId,
		"com.apple.developer.team-identifier": team,
		"get-task-allow": false,
		"beta-reports-active": true,
	}
	writeFileSync(
		`${out}/build/extension-entitlements.json`,
		JSON.stringify(
			extensionCommunication
				? { ...extensionEntitlementValues, [communicationEntitlement]: true }
				: extensionEntitlementValues,
		),
	)
	run("plutil", [
		"-convert",
		"xml1",
		"-o",
		extensionEntitlements,
		`${out}/build/extension-entitlements.json`,
	])
	run("codesign", [
		"--sign",
		process.env.HAZEL_IOS_IDENTITY || "Apple Distribution",
		"--entitlements",
		extensionEntitlements,
		"--generate-entitlement-der",
		"--force",
		extensionBundle,
	])
}
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
