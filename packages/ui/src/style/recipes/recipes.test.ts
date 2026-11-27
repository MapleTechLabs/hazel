import { readdirSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { isTagKey } from "../../vocabulary/spec.ts"
import { recipes } from "./index.ts"

/** C3's file shape: one recipe per primitive, named after its tag, for a tag in the vocabulary. */
describe("recipe files", () => {
	it("are one per vocabulary tag, file named after the primitive", () => {
		const files = readdirSync(import.meta.dirname).filter(
			(file) => file.endsWith(".ts") && file !== "index.ts" && !file.includes(".test."),
		)
		expect(recipes.map((recipe) => `${recipe.primitive}.ts`).sort()).toEqual(files.sort())
		for (const recipe of recipes) expect(isTagKey(recipe.primitive), recipe.primitive).toBe(true)
	})
})
