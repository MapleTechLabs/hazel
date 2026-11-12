/**
 * The Bun platform: the native host spawns this process and talks to it over stdin/stdout. It
 * answers `NativePlatform` with Bun and Node APIs and starts the runtime (`src/runtime.ts`).
 */
import { spawn } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { stdioTransport, StyleResolver } from "@hazel/foldkit-rune"
import { overlayPlugin } from "./overlay-plugin"
import type { NativePlatform } from "./platform"

// Before any app module loads: its overlay helpers become the host-drawn ones.
Bun.plugin(overlayPlugin)

// A browser reports an uncaught error and keeps the page running; one stray error in a timer
// must not end the runtime and leave the window unresponsive.
const reportUncaught = (kind: string) => (error: unknown) => {
	const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
	process.stderr.write(`[uncaught ${kind}] ${detail}\n`)
}
process.on("uncaughtException", reportUncaught("error"))
process.on("unhandledRejection", reportUncaught("rejection"))
// The host asks the runtime to stop with SIGTERM: exit normally, so exit work (a CPU profile) runs.
process.on("SIGTERM", () => process.exit(0))

/**
 * `localStorage`'s file: `HAZEL_STORAGE_PATH`, else in the app's Application Support folder (the
 * bundle's identifier, `HAZEL_APP_ID`, which `scripts/bundle.ts` sets).
 */
const storagePath =
	process.env.HAZEL_STORAGE_PATH ??
	join(homedir(), "Library/Application Support", process.env.HAZEL_APP_ID ?? "com.hazel.native", "local-storage.json")

const platform: NativePlatform = {
	connect: stdioTransport,
	log: (line) => process.stderr.write(`${line}\n`),
	openUrl: (href) => {
		const opener = spawn(process.platform === "darwin" ? "open" : "xdg-open", [href], {
			stdio: "ignore",
		})
		opener.on("error", () => {})
	},
	copyText: (text) => {
		const copy = spawn("pbcopy", { stdio: ["pipe", "ignore", "ignore"] })
		// Without pbcopy (Linux, a stripped PATH) the copy is dropped instead of taking the runtime down.
		copy.on("error", () => {})
		copy.stdin.on("error", () => {})
		copy.stdin.end(text)
	},
	// The bundled runtime ships its sheet compiled (`bun run build`); from source it compiles here.
	loadStyles: async () => {
		const stylesheet = new URL("../../web-foldkit/src/styles.css", import.meta.url).pathname
		const precompiledPath =
			process.env.HAZEL_NATIVE_STYLES ?? new URL("./styles.json", import.meta.url).pathname
		return existsSync(precompiledPath)
			? StyleResolver.fromPrecompiled(JSON.parse(readFileSync(precompiledPath, "utf8")), stylesheet)
			: await StyleResolver.load(stylesheet)
	},
	storage: {
		load: () => {
			try {
				const saved: unknown = JSON.parse(readFileSync(storagePath, "utf8"))
				if (typeof saved !== "object" || saved === null) return undefined
				return Object.fromEntries(
					Object.entries(saved).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
				)
			} catch {
				// No file yet, or one cut short: start empty, as a browser with cleared storage does.
				return undefined
			}
		},
		save: (entries) => {
			try {
				mkdirSync(dirname(storagePath), { recursive: true })
				// Written beside it and renamed over it, so a crash mid-write never leaves half a file.
				const next = `${storagePath}.next`
				writeFileSync(next, JSON.stringify(entries))
				renameSync(next, storagePath)
			} catch (error) {
				process.stderr.write(`[storage] not saved: ${String(error)}\n`)
			}
		},
	},
	onExit: (work) => process.on("exit", work),
	appendLine: (path, line) => appendFileSync(path, `${line}\n`),
	memoryUsedMb: () => process.memoryUsage().heapUsed / 1048576,
	fixtureHtmlRender: async (file) => (await import("./fixture/html-render")).makeFixtureHtmlRender(file),
}

// Imported after the plugin, so the runtime and the app modules it loads go through it.
const { startRuntime } = await import("./runtime")
await startRuntime(platform)
