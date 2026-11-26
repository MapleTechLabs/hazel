import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { type Group, type TagKey, tagKeys, tags } from "../src/vocabulary/spec.ts"
import { hazelUI, swiftStub, viewPath } from "./swift-vocabulary.ts"

/**
 * `bun scripts/stubs.ts` (integrator, when a tag joins `spec.ts`): writes each missing per-tag file once,
 * a web stub renderer, a Swift stub view and a default conformance fixture, which their lanes then own.
 * Recipe stubs are written for tags listed in `recipeStubs` only (a recipe changes the generated CSS).
 */

const root = resolve(import.meta.dirname, "..")

const webFolders = {
	layout: "layout",
	collections: "list",
	content: "content",
	chat: "chat",
	controls: "controls",
	overlays: "overlays",
	structure: "structure",
	internal: "layout",
} as const satisfies { readonly [G in Group]: string }

export const webPath = (key: TagKey) =>
	key === "action" ? "structure/action.ts" : `${webFolders[tags[key].group]}/${key}.ts`

const webStub = (
	key: TagKey,
) => `// Owned by lane ${tags[key].web} (\`docs/hazel-ui.md\`, "Phase 2: lanes"). Phase 1.5 stub: draws a
// placeholder naming the lane; the lane replaces it with the renderer (\`definePrimitive\`).
import { stubPrimitive } from "../define.ts"

export const primitive = stubPrimitive("${key}")
`

const recipeStub = (key: TagKey) => `import { defineRecipe } from "../recipe.ts"

/** \`hz:${key}\`: a phase 1.5 stub; lane ${tags[key].web} fills it with the primitive, lane D reviews it. */
export const ${key} = defineRecipe<{}, never, never>({
	primitive: "${key}",
	parts: {},
	base: { root: {} },
	options: {},
})
`

const fixtureStub = (key: TagKey) =>
	`${JSON.stringify(
		{
			about: `hz:${key} with no props: lane ${tags[key].web} and lane ${tags[key].ios} replace this with real cases.`,
			root: { tag: key },
		},
		null,
		"\t",
	)}\n`

/** Tags added after C3 whose recipe file starts as an empty stub. */
const recipeStubs: ReadonlyArray<TagKey> = ["progress", "emptyState", "emojiPicker"]

const write = (path: string, content: string) => {
	if (existsSync(path)) return
	mkdirSync(dirname(path), { recursive: true })
	writeFileSync(path, content)
	console.log(`stub ${path.slice(root.length + 1)}`)
}

const internal = new Set<TagKey>(["slot", "action", "ext"])

for (const key of tagKeys) {
	write(resolve(root, "src/web/primitives", webPath(key)), webStub(key))
	write(resolve(hazelUI, viewPath(key)), swiftStub(key))
	// Internal tags are covered by their owners' fixtures (`ext` has its own).
	const fixtures = resolve(root, "src/conformance/fixtures")
	if (existsSync(fixtures) && (!internal.has(key) || key === "ext"))
		if (!existsSync(resolve(fixtures, key)))
			write(resolve(root, "src/conformance/fixtures", key, "default.json"), fixtureStub(key))
}
for (const key of recipeStubs) write(resolve(root, "src/style/recipes", `${key}.ts`), recipeStub(key))
