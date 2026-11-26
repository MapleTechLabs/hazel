import { readdirSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import type { Hazel } from "../vocabulary/index.ts"

/**
 * Every governed composite (`h.custom`), found by file glob: each `<Name>.ts` here exports one
 * `Hazel.composite`. Tooling only (the gallery and the cap check); screens import a composite directly.
 * `hazel/custom-cap` (.oxlintrc.json) caps how many there are; only the user raises it.
 */
const files = readdirSync(import.meta.dirname)
	.filter((file) => file.endsWith(".ts") && file !== "index.ts" && !file.includes(".test."))
	.sort()

const isComposite = (value: unknown): value is Hazel.AnyComposite =>
	typeof value === "object" && value !== null && "_tag" in value && value._tag === "HazelComposite"

export const composites: ReadonlyArray<Hazel.AnyComposite> = (
	await Promise.all(
		files.map(async (file) => {
			const module: Record<string, unknown> = await import(
				pathToFileURL(resolve(import.meta.dirname, file)).href
			)
			return Object.values(module).filter(isComposite)
		}),
	)
).flat()
