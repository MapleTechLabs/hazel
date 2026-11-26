import { readdirSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import type { Recipe } from "../schema.ts"

/**
 * Every recipe, found by file glob: each `<primitive>.ts` here exports one recipe, so adding a
 * primitive never edits a shared list. Codegen only (Node or Bun); order is by file name.
 */
const files = readdirSync(import.meta.dirname)
	.filter((file) => file.endsWith(".ts") && file !== "index.ts" && !file.includes(".test."))
	.sort()

const isRecipe = (value: unknown): value is Recipe =>
	typeof value === "object" && value !== null && "primitive" in value && "base" in value

export const recipes: ReadonlyArray<Recipe> = (
	await Promise.all(
		files.map(async (file) => {
			const module: Record<string, unknown> = await import(pathToFileURL(resolve(import.meta.dirname, file)).href)
			const found = Object.values(module).filter(isRecipe)
			if (found.length !== 1) throw new Error(`recipes/${file} must export exactly one recipe`)
			return found[0]!
		}),
	)
).filter((recipe, index, all) => all.findIndex((other) => other.primitive === recipe.primitive) === index)
