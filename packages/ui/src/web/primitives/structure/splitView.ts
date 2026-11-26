// Owned by lane A4 (`docs/hazel-ui.md`, "Phase 2: lanes"). `hz:splitView`: the `sidebar` slot beside the
// main content (regular), or above it (compact). Slots never move: flex order places them.
import { definePrimitive, type Primitive } from "../define.ts"
import { ensureSheet } from "../list/runtime.ts"

const css = `
[data-hz="splitView"] { display: flex; flex-direction: column; min-height: 0; }
[data-hz="splitView"] > [data-hz-slot="sidebar"] { order: -1; display: flex; flex-direction: column; min-width: 0; }
[data-hz="splitView"] > :not([data-hz-slot="sidebar"]) { flex: 1 1 auto; min-width: 0; min-height: 0; }
@media (width >= 40rem) {
	[data-hz="splitView"] { flex-direction: row; }
	[data-hz="splitView"] > [data-hz-slot="sidebar"] {
		flex: none; width: calc(var(--hz-space-12) * 5); border-inline-end: 1px solid var(--hz-color-separator);
	}
}
`

export const primitive = definePrimitive("splitView", ({ document, outer, self }) => {
	ensureSheet(document, "splitView", css)
	const node = outer("div")
	const primitive: Primitive = self(node, () => {})
	return primitive
})
