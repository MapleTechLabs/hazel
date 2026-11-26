/**
 * Outside `platform/web/` and `platform/jsc/` (the hosts), no source names a browser global: those reach the package only through
 * the platform services. `node-load.test.ts` checks the same by running without them.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { expect, test } from "vitest"

const BROWSER_GLOBALS = [
	"window",
	"document",
	"navigator",
	"location",
	"localStorage",
	"sessionStorage",
	"indexedDB",
	"WebSocket",
	"fetch",
	"Request",
	"Response",
	"Headers",
	"URL",
	"AbortController",
	"crypto",
	"Worker",
	"addEventListener",
	"removeEventListener",
	"dispatchEvent",
	"CustomEvent",
	"requestAnimationFrame",
	"globalThis",
	"self",
]

const root = new URL(".", import.meta.url).pathname
const HOSTS = [join("platform", "web"), join("platform", "jsc")]

const sources = (dir: string): Array<string> =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name)
		if (entry.isDirectory()) return HOSTS.includes(relative(root, path)) ? [] : sources(path)
		return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : []
	})

/** Drops comments and string contents, so only code is searched. */
const codeOf = (text: string) =>
	text
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\/\/.*$/gm, "")
		.replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""')

// A use of the global: not a property (`x.fetch`), a key (`fetch:`), a type member or an import name.
const uses = new RegExp(`(?<![.\\w$])(${BROWSER_GLOBALS.join("|")})\\b(?!\\s*\\??:)`, "g")

/** Names the file imports (`Headers` from `effect/http`): its own, not the global. */
const importedNames = (text: string) =>
	new Set(
		[...text.matchAll(/^import\s+(?:type\s+)?\{([^}]*)\}/gm)].flatMap((match) =>
			match[1]!.split(",").map((name) =>
				name
					.trim()
					.split(/\s+as\s+/)
					.at(-1)!
					.replace(/^type\s+/, ""),
			),
		),
	)

test("no browser global outside the platform hosts", () => {
	const found = sources(root).flatMap((path) => {
		const text = readFileSync(path, "utf8")
		const imported = importedNames(text)
		return [...codeOf(text).matchAll(uses)]
			.filter((match) => !imported.has(match[1]!))
			.map((match) => `${relative(root, path)}: ${match[1]}`)
	})
	expect(sources(root).length).toBeGreaterThan(5)
	expect(found).toEqual([])
})
