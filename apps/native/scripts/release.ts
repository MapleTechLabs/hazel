/**
 * Makes the macOS downloads from the app `HAZEL_RELEASE=1 bun scripts/bundle.ts` signed, into
 * `dist/release/`:
 *
 *   Hazel_<version>_<arch>.dmg             what the landing page offers (the app and /Applications)
 *   Hazel_<version>_<arch>.app.tar.gz      the update archive, as Tauri's: `Hazel.app` at its top
 *   Hazel_<version>_<arch>.app.tar.gz.sig  its minisign signature, base64, for `latest.json`
 *
 * Arch names follow the Tauri bundles' (`aarch64`, `x64`), so the landing page's asset patterns
 * and the release's naming stay as they were. The disk image is notarized and stapled, and so is
 * the app before it is archived. Needs `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`
 * (an app-specific password), `APPLE_TEAM_ID`, and `TAURI_SIGNING_PRIVATE_KEY` (with
 * `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`); `HAZEL_SKIP_NOTARIZE=1` skips notarizing, for a dry run.
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs"

const root = new URL("..", import.meta.url).pathname
const arch = process.env.HAZEL_BUNDLE_ARCH ?? (process.arch === "arm64" ? "aarch64" : "x86_64")
const assetArch = arch === "aarch64" ? "aarch64" : "x64"
// SAFETY: the repo's own Tauri config; the Tauri build fails without its `version`.
const { version } = JSON.parse(readFileSync(`${root}../desktop/src-tauri/tauri.conf.json`, "utf8")) as {
	version: string
}
const app = `${root}dist/Hazel.app`
const out = `${root}dist/release`
const base = `${out}/Hazel_${version}_${assetArch}`

const need = (name: string) => {
	const value = process.env[name]
	if (!value) throw new Error(`release.ts needs ${name}`)
	return value
}
const run = (command: string, args: Array<string>, cwd = root) =>
	execFileSync(command, args, { cwd, stdio: "inherit" })

const identity = need("APPLE_SIGNING_IDENTITY")
const notarize = process.env.HAZEL_SKIP_NOTARIZE !== "1"

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

// The disk image: the app beside a link to /Applications, signed, then notarized; notarizing it
// also registers the app inside, so both take a stapled ticket and open offline.
const stage = `${out}/dmg`
mkdirSync(stage)
run("ditto", [app, `${stage}/Hazel.app`])
symlinkSync("/Applications", `${stage}/Applications`)
run("hdiutil", ["create", "-volname", "Hazel", "-srcfolder", stage, "-ov", "-format", "UDZO", `${base}.dmg`])
rmSync(stage, { recursive: true, force: true })
run("codesign", ["--force", "--timestamp", "--sign", identity, `${base}.dmg`])

if (notarize) {
	run("xcrun", [
		"notarytool",
		"submit",
		`${base}.dmg`,
		"--apple-id",
		need("APPLE_ID"),
		"--password",
		need("APPLE_PASSWORD"),
		"--team-id",
		need("APPLE_TEAM_ID"),
		"--wait",
	])
	run("xcrun", ["stapler", "staple", `${base}.dmg`])
	run("xcrun", ["stapler", "staple", app])
	run("spctl", ["--assess", "--type", "execute", "--verbose", app])
}

// The update archive, as the Tauri updater and `host/src/updater.rs` unpack it, and its signature
// by Tauri's own signer with the release key.
run("tar", ["-czf", `${base}.app.tar.gz`, "-C", `${root}dist`, "Hazel.app"])
need("TAURI_SIGNING_PRIVATE_KEY")
run("bunx", ["tauri", "signer", "sign", `${base}.app.tar.gz`], `${root}../desktop`)

process.stdout.write(`${out}\n`)
