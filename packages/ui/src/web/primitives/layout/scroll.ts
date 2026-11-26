// Owned by lane A1 (`docs/hazel-ui.md`, "Phase 2: lanes").
import { definePrimitive, option } from "../define.ts"

// HAZEL-GAP(recipe-overflow): a recipe cannot say `overflow`; the scroller sets it here.
const overflow = (node: HTMLElement, axis: unknown) => {
	const horizontal = axis === "horizontal"
	node.style.overflowX = horizontal ? "auto" : "hidden"
	node.style.overflowY = horizontal ? "hidden" : "auto"
}

export const primitive = definePrimitive("scroll", ({ outer, self }) => {
	const node = outer("div")
	overflow(node, "vertical")
	return self(node, (name, value) => {
		if (name !== "axis") return
		option(node, "axis", value)
		overflow(node, value)
	})
})
