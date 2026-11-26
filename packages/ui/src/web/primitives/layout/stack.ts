// Owned by lane A1 (`docs/hazel-ui.md`, "Phase 2: lanes").
import { definePrimitive, option } from "../define.ts"

export const primitive = definePrimitive("stack", ({ outer, self }) => {
	const node = outer("div")
	return self(node, (name, value) => {
		if (name !== "axis" && name !== "density" && name !== "align") return
		option(node, name, value)
		// HAZEL-GAP(recipe-align-end): a recipe's `align` has no `end`; drawn here until it does.
		if (name === "align") node.style.alignItems = value === "end" ? "flex-end" : ""
	})
})
