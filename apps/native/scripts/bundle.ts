/**
 * Builds the Mac app: the release host, the runtime compiled to one executable beside it, the
 * precompiled stylesheet, the environment it runs with (live against production), and an
 * Info.plist that registers the sign-in callback scheme.
 *
 *   bun scripts/bundle.ts                       dist/Hazel Native.app, ad-hoc signed, this Mac only
 *   HAZEL_BACKEND_URL=http://localhost:3003 HAZEL_APP_URL=http://localhost:3100 bun scripts/bundle.ts
 *
 * `HAZEL_RELEASE=1` builds the app Hazel ships for macOS instead: `dist/Hazel.app` as `com.hazel.app`
 * (it takes the Tauri app's place, and the Tauri updater installs it over that one), at the
 * Tauri app's version (`apps/desktop/src-tauri/tauri.conf.json`), updating itself from the same
 * feed with the same key, signed with `APPLE_SIGNING_IDENTITY` under the hardened runtime.
 * `HAZEL_BUNDLE_ARCH=x86_64` (or `aarch64`) builds for that Mac; the default is this one's.
 * `scripts/release.ts` then notarizes it and makes the downloads.
 */
import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"

import { nativeClient } from "@hazel/auth/contract"

import { overlayPlugin } from "../src/overlay-plugin"
import { prismPlugin } from "./prism-plugin"

const root = new URL("..", import.meta.url).pathname
const release = process.env.HAZEL_RELEASE === "1"
const arch = process.env.HAZEL_BUNDLE_ARCH ?? (process.arch === "arm64" ? "aarch64" : "x86_64")
if (arch !== "aarch64" && arch !== "x86_64") throw new Error(`HAZEL_BUNDLE_ARCH: ${arch}`)
const rustTarget = `${arch}-apple-darwin`
const bunTarget = arch === "aarch64" ? "bun-darwin-arm64" : "bun-darwin-x64"

/** The Tauri app's version and update key: one version and one feed for both apps. */
// SAFETY: the repo's own Tauri config; the Tauri build fails without `version` and the updater key.
const tauri = JSON.parse(readFileSync(`${root}../desktop/src-tauri/tauri.conf.json`, "utf8")) as {
	version: string
	plugins: { updater: { pubkey: string } }
}
const version = tauri.version
const product = release
	? { name: "Hazel", id: "com.hazel.app" }
	: { name: "Hazel Native", id: "com.hazel.native" }
const app = `${root}dist/${product.name}.app`
const contents = `${app}/Contents`
const scheme = new URL(nativeClient.returnUrl).protocol.slice(0, -1)
const identity = release ? process.env.APPLE_SIGNING_IDENTITY : undefined
if (release && !identity) throw new Error("HAZEL_RELEASE=1 needs APPLE_SIGNING_IDENTITY")

// The Tauri app's production origins (apps/web-foldkit/scripts/production-env.sh). `||`: an
// unset GitHub `vars` value arrives as an empty string, which must not ship as the backend.
const environment = {
	HAZEL_DATA: "live",
	VITE_BACKEND_URL: process.env.HAZEL_BACKEND_URL || "https://api.hazel.sh",
	VITE_APP_URL: process.env.HAZEL_APP_URL || "https://app.hazel.sh",
	VITE_R2_PUBLIC_URL: process.env.HAZEL_R2_PUBLIC_URL || "https://cdn.hazel.sh",
}

const run = (command: string, args: Array<string>, options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) =>
	execFileSync(command, args, { cwd: options.cwd ?? root, stdio: "inherit", env: options.env })

rmSync(app, { recursive: true, force: true })
mkdirSync(`${contents}/MacOS`, { recursive: true })
mkdirSync(`${contents}/Resources`, { recursive: true })

// A release host knows its version and update key, so it offers updates (`host/src/updater.rs`).
run("cargo", ["build", "--release", "--target", rustTarget], {
	cwd: `${root}host`,
	env: release
		? { ...process.env, HAZEL_VERSION: version, HAZEL_UPDATER_PUBKEY: tauri.plugins.updater.pubkey }
		: process.env,
})
cpSync(`${root}host/target/${rustTarget}/release/hazel-native`, `${contents}/MacOS/hazel-native`)

// ESM keeps the runtime's top-level awaits; bytecode skips parsing at launch.
const runtime = await Bun.build({
	entrypoints: [`${root}src/entry.ts`],
	compile: { outfile: `${contents}/MacOS/hazel-runtime`, target: bunTarget },
	format: "esm",
	bytecode: process.env.HAZEL_BUNDLE_BYTECODE !== "0",
	minify: true,
	// Tailwind's compiler (native addons) runs only for a class the precompiled sheet missed.
	external: ["@tailwindcss/oxide", "@tailwindcss/node", "lightningcss"],
	plugins: [overlayPlugin, prismPlugin],
})
if (!runtime.success) {
	for (const log of runtime.logs) process.stderr.write(`${String(log)}\n`)
	process.exit(1)
}

run(process.execPath, ["scripts/precompile-styles.ts"])
cpSync(`${root}dist/styles.json`, `${contents}/Resources/styles.json`)
cpSync(`${root}../desktop/src-tauri/icons/icon.icns`, `${contents}/Resources/icon.icns`)
// Images the app names by path (`/images/...`): the host reads them from here.
cpSync(`${root}../web-foldkit/public`, `${contents}/Resources/public`, { recursive: true })
// The host hands these to the runtime however the app starts (`host/src/platform.rs`).
writeFileSync(`${contents}/Resources/environment.json`, `${JSON.stringify(environment, null, "\t")}\n`)

const escape = (value: string) =>
	value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

// HTML render frames load their pages from the backend in a web view, which App Transport
// Security holds to https: a bundle built against a local backend (http://localhost) may load
// from the local network. A release bundle talks https and gets no exception.
const localNetworking = environment.VITE_BACKEND_URL.startsWith("http://")
	? `
	<key>NSAppTransportSecurity</key>
	<dict>
		<key>NSAllowsLocalNetworking</key>
		<true/>
	</dict>`
	: ""

writeFileSync(
	`${contents}/Info.plist`,
	`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleIdentifier</key>
	<string>${product.id}</string>
	<key>CFBundleName</key>
	<string>${escape(product.name)}</string>
	<key>CFBundleDisplayName</key>
	<string>${escape(product.name)}</string>
	<key>CFBundleExecutable</key>
	<string>hazel-native</string>
	<key>CFBundleIconFile</key>
	<string>icon</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>${escape(version)}</string>
	<key>CFBundleVersion</key>
	<string>${escape(version)}</string>
	<key>LSMinimumSystemVersion</key>
	<string>13.0</string>
	<key>LSApplicationCategoryType</key>
	<string>public.app-category.business</string>
	<key>NSHighResolutionCapable</key>
	<true/>${localNetworking}
	<key>CFBundleURLTypes</key>
	<array>
		<dict>
			<key>CFBundleURLName</key>
			<string>${product.id}</string>
			<key>CFBundleURLSchemes</key>
			<array>
				<string>${escape(scheme)}</string>
			</array>
		</dict>
	</array>
</dict>
</plist>
`,
)

if (identity) {
	// The runtime is Bun: its JIT needs writable executable memory under the hardened runtime.
	const entitlements = `${root}dist/runtime.entitlements`
	writeFileSync(
		entitlements,
		`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.security.cs.allow-jit</key>
	<true/>
	<key>com.apple.security.cs.allow-unsigned-executable-memory</key>
	<true/>
	<key>com.apple.security.cs.disable-library-validation</key>
	<true/>
</dict>
</plist>
`,
	)
	const sign = ["--force", "--timestamp", "--options", "runtime", "--sign", identity]
	run("codesign", [...sign, "--entitlements", entitlements, `${contents}/MacOS/hazel-runtime`])
	run("codesign", [...sign, `${contents}/MacOS/hazel-native`])
	run("codesign", [...sign, app])
	run("codesign", ["--verify", "--strict", "--verbose=2", app])
} else {
	// Ad-hoc: launches on this Mac, nowhere else. Then Launch Services learns the callback scheme.
	run("codesign", ["--force", "--sign", "-", `${contents}/MacOS/hazel-runtime`])
	run("codesign", ["--force", "--sign", "-", app])
	run(
		"/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
		["-f", app],
	)
}

process.stdout.write(
	`${app}\n  ${product.id} ${version} (${arch}), live against ${environment.VITE_BACKEND_URL}, callback ${scheme}://\n`,
)
