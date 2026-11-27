// Owned by lane A1 (`docs/hazel-ui.md`, "Phase 2: lanes").
import { ensureStyles } from "../content/styles.ts"
import { definePrimitive, option } from "../define.ts"

// Children in equal columns; the tracks are renderer CSS (`content/styles.ts`), the gap the recipe's.
export const primitive = definePrimitive("grid", ({ document, outer, self }) => {
	ensureStyles(document)
	const node = outer("div")
	return self(node, (name, value) => {
		if (name === "columns" || name === "density") option(node, name, value)
	})
})
