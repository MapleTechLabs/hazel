import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { recipes } from "../src/style/recipes/index.ts"
import { tokens } from "../src/style/tokens.ts"
import { generateCss } from "./css.ts"
import { generateSwift } from "./swift.ts"
import { generateSwiftRegistry, hazelUI } from "./swift-vocabulary.ts"

/**
 * `bun run --cwd packages/ui ui:generate`: writes `src/style/generated/{tokens.css,Theme.swift}` from
 * the tokens and recipes, and HazelUI's theme and primitive registry. `--check` writes nothing and
 * exits 1 when any output is stale.
 */

const generatedDir = resolve(import.meta.dirname, "../src/style/generated")

export const outputs = (): ReadonlyArray<{ readonly path: string; readonly content: string }> => [
	{ path: resolve(generatedDir, "tokens.css"), content: generateCss(tokens, recipes) },
	{ path: resolve(generatedDir, "Theme.swift"), content: generateSwift(tokens, recipes) },
	// HazelUI's own copies (C0): the theme its primitives read, and the tag-to-view registry.
	{ path: resolve(hazelUI, "Theme/HazelTheme.generated.swift"), content: generateSwift(tokens, recipes) },
	{ path: resolve(hazelUI, "Primitives/Registry.generated.swift"), content: generateSwiftRegistry() },
]

const read = (path: string) => {
	try {
		return readFileSync(path, "utf8")
	} catch {
		return undefined
	}
}

/** The generated files whose content on disk differs from what the sources produce now. */
export const staleOutputs = (): ReadonlyArray<string> =>
	outputs()
		.filter((output) => read(output.path) !== output.content)
		.map((output) => output.path)

if (import.meta.main) {
	if (process.argv.includes("--check")) {
		const stale = staleOutputs()
		for (const path of stale) console.error(`stale: ${path}`)
		process.exit(stale.length === 0 ? 0 : 1)
	}
	for (const output of outputs()) writeFileSync(output.path, output.content)
	console.log(
		outputs()
			.map((output) => output.path)
			.join("\n"),
	)
}
