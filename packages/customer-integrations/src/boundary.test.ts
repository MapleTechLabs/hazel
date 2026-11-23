/**
 * Core Customers code names no registered integration (`docs/customers/integrations.md`). The words
 * come from the registry, so a new integration is covered by registering it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { integrations } from "./registry"

const ROOT = resolve(import.meta.dirname, "../../..")
const PACKAGE_SOURCE = "packages/customer-integrations/src"
const SEED = "apps/backend/src/worker/objects/customers/seed.ts"

const CORE_PATHS = [
	"apps/backend/src/worker/objects/customers",
	"apps/backend/src/rpc/handlers/customers.ts",
	"apps/backend/src/routes/customers-webhooks.http.ts",
	"packages/domain/src/customers",
	"packages/domain/src/rpc/customers.ts",
	"packages/db/src/tables/customers.ts",
	`${PACKAGE_SOURCE}/kit`,
	"apps/web-foldkit/src/customers",
	"apps/web-foldkit/src/page/customers",
	"apps/web-foldkit/src/page/chat/customer-card.gallery.ts",
	"apps/web-foldkit/src/lab/entries/customers",
]
const LAB_FIXTURES = "apps/web-foldkit/src/lab/fixtures"

/** Every entry says why that exact text may stay on the core side. */
const ALLOWED: ReadonlyArray<{ readonly file: string; readonly text: string; readonly reason: string }> = [
	{
		file: "packages/db/src/tables/customers.ts",
		text: "@maple-dev/effect-orm",
		reason: "The ORM's package name, not the integration.",
	},
	{
		file: SEED,
		text: '"Maple",',
		reason: "A word in the generated company names; dropping it changes the seeded data.",
	},
]

/** Tests and their support keep naming tools: unchanged, they prove the behaviour stayed equal. */
const isExempt = (file: string) => file.endsWith(".test.ts") || file.endsWith("/test-kit.ts")

const filesUnder = (path: string): ReadonlyArray<string> =>
	statSync(join(ROOT, path)).isDirectory()
		? readdirSync(join(ROOT, path)).flatMap((entry) => filesUnder(`${path}/${entry}`))
		: [path]

const coreFiles = [
	...CORE_PATHS.flatMap(filesUnder),
	...filesUnder(LAB_FIXTURES).filter((file) => file.startsWith(`${LAB_FIXTURES}/customers`)),
].filter((file) => /\.(ts|md)$/.test(file) && !isExempt(file))

const escaped = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const words = [
	...new Set(integrations.flatMap(({ id, presentation }) => [id, presentation.name.toLowerCase()])),
]
const MENTION = new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.map(escaped).join("|")})(?![\\p{L}\\p{N}])`, "iu")

/** Splits camelCase, so `someToolId` reads as words; `_` and `-` already separate them. */
const mentionsTool = (line: string) => MENTION.test(line.replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2"))

const withoutAllowed = (file: string, line: string) =>
	ALLOWED.filter((entry) => entry.file === file).reduce(
		(current, entry) => current.replaceAll(entry.text, ""),
		line,
	)

const sourceOf = (file: string): string =>
	// oxlint-disable-next-line test-slop/no-source-text-assertions -- the guard the boundary doc specifies: its words come from the registry, which a static lint rule cannot import
	readFileSync(join(ROOT, file), "utf8")

const linesOf = (file: string) =>
	sourceOf(file)
		.split("\n")
		.map((text, index) => ({ at: `${file}:${index + 1}`, text }))

const IMPORT = /(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g
const folders = integrations.map(({ id }) => `${PACKAGE_SOURCE}/${id}`)

/** Into an integration's folder, by the package's name or by a relative path. */
const entersFolder = (file: string, specifier: string) => {
	const path = specifier.startsWith("@hazel/customer-integrations/")
		? `${PACKAGE_SOURCE}/${specifier.slice("@hazel/customer-integrations/".length)}`
		: specifier.startsWith(".")
			? relative(ROOT, resolve(ROOT, dirname(file), specifier))
			: null
	return path !== null && folders.some((folder) => path === folder || path.startsWith(`${folder}/`))
}

describe("the integration boundary", () => {
	it("scans the core and derives its words from the registry", () => {
		expect(coreFiles.length).toBeGreaterThan(100)
		expect(words.length).toBeGreaterThanOrEqual(integrations.length)
	})

	it("core names no registered integration", () => {
		const mentions = coreFiles.flatMap((file) =>
			linesOf(file)
				.filter(({ text }) => mentionsTool(withoutAllowed(file, text)))
				.map(({ at, text }) => `${at}: ${text.trim()}`),
		)
		expect(mentions).toEqual([])
	})

	it("core reaches integrations through the package's public entries", () => {
		const imports = coreFiles.flatMap((file) =>
			linesOf(file).flatMap(({ at, text }) =>
				[...text.matchAll(IMPORT)]
					.filter(([, specifier]) => entersFolder(file, specifier))
					.map(([, specifier]) => `${at}: ${specifier}`),
			),
		)
		expect(imports).toEqual([])
	})

	it("every allowance still matches something", () => {
		const stale = ALLOWED.filter(({ file, text }) => !sourceOf(file).includes(text))
		expect(stale).toEqual([])
	})
})
