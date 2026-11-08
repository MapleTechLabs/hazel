/**
 * Builds `dist/Hazel Native.app`: the release host, the runtime compiled to one executable
 * beside it, the precompiled stylesheet, and an Info.plist that registers the sign-in callback
 * scheme and opens live against production. Ad-hoc signed, so it launches on this Mac.
 *
 *   bun scripts/bundle.ts
 *   HAZEL_BACKEND_URL=http://localhost:3003 HAZEL_APP_URL=http://localhost:3100 bun scripts/bundle.ts
 */
import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"

import { nativeClient } from "@hazel/auth/contract"

import { overlayPlugin } from "../src/overlay-plugin"

const root = new URL("..", import.meta.url).pathname
const app = `${root}dist/Hazel Native.app`
const contents = `${app}/Contents`
const scheme = new URL(nativeClient.returnUrl).protocol.slice(0, -1)

// The Tauri app's production origins (apps/web-foldkit/scripts/production-env.sh).
const environment = {
	HAZEL_DATA: "live",
	VITE_BACKEND_URL: process.env.HAZEL_BACKEND_URL ?? "https://api.hazel.sh",
	VITE_APP_URL: process.env.HAZEL_APP_URL ?? "https://app.hazel.sh",
	VITE_R2_PUBLIC_URL: process.env.HAZEL_R2_PUBLIC_URL ?? "https://cdn.hazel.sh",
}

const run = (command: string, args: Array<string>, cwd = root) =>
	execFileSync(command, args, { cwd, stdio: "inherit" })

rmSync(app, { recursive: true, force: true })
mkdirSync(`${contents}/MacOS`, { recursive: true })
mkdirSync(`${contents}/Resources`, { recursive: true })

run("cargo", ["build", "--release"], `${root}host`)
cpSync(`${root}host/target/release/hazel-native`, `${contents}/MacOS/hazel-native`)

/** Prism's language files use the global its core sets: import the core first, explicitly. */
const prismPlugin: BunPlugin = {
	name: "hazel-native-prism",
	setup(build) {
		build.onLoad({ filter: /prismjs\/components\/prism-[\w-]+\.js$/ }, ({ path }) => ({
			contents: `import Prism from "prismjs";\n${readFileSync(path, "utf8")}`,
			loader: "js",
		}))
	},
}

// ESM keeps the runtime's top-level awaits; bytecode skips parsing at launch.
const runtime = await Bun.build({
	entrypoints: [`${root}src/entry.ts`],
	compile: { outfile: `${contents}/MacOS/hazel-runtime` },
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

run(process.execPath, ["scripts/precompile-styles.ts"], root)
cpSync(`${root}dist/styles.json`, `${contents}/Resources/styles.json`)
cpSync(`${root}../desktop/src-tauri/icons/icon.icns`, `${contents}/Resources/icon.icns`)
// Images the app names by path (`/images/...`): the host reads them from here.
cpSync(`${root}../web-foldkit/public`, `${contents}/Resources/public`, { recursive: true })

const escape = (value: string) =>
	value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
const entries = (record: Record<string, string>) =>
	Object.entries(record)
		.map(([key, value]) => `\t\t<key>${escape(key)}</key>\n\t\t<string>${escape(value)}</string>`)
		.join("\n")

writeFileSync(
	`${contents}/Info.plist`,
	`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleIdentifier</key>
	<string>com.hazel.native</string>
	<key>CFBundleName</key>
	<string>Hazel Native</string>
	<key>CFBundleDisplayName</key>
	<string>Hazel Native</string>
	<key>CFBundleExecutable</key>
	<string>hazel-native</string>
	<key>CFBundleIconFile</key>
	<string>icon</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>0.0.1</string>
	<key>CFBundleVersion</key>
	<string>1</string>
	<key>LSMinimumSystemVersion</key>
	<string>13.0</string>
	<key>NSHighResolutionCapable</key>
	<true/>
	<key>CFBundleURLTypes</key>
	<array>
		<dict>
			<key>CFBundleURLName</key>
			<string>com.hazel.native</string>
			<key>CFBundleURLSchemes</key>
			<array>
				<string>${escape(scheme)}</string>
			</array>
		</dict>
	</array>
	<key>LSEnvironment</key>
	<dict>
${entries(environment)}
	</dict>
</dict>
</plist>
`,
)

// Ad-hoc: launches on this Mac, nowhere else. Then Launch Services learns the callback scheme.
run("codesign", ["--force", "--sign", "-", `${contents}/MacOS/hazel-runtime`])
run("codesign", ["--force", "--sign", "-", app])
run(
	"/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
	["-f", app],
)

process.stdout.write(`${app}\n  live against ${environment.VITE_BACKEND_URL}, callback ${scheme}://\n`)
