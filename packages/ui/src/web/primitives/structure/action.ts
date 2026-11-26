// Owned by lane A4 (`docs/hazel-ui.md`, "Phase 2: lanes"). The G1 renderer, moved here in C0.
import { definePrimitive } from "../define.ts"

export const primitive = definePrimitive("action", ({ outer, self }) => {
	const node = outer("button")
	node.setAttribute("type", "button")
	return self(node, (name, value) => {
		if (name === "label") {
			if (typeof value === "string") node.setAttribute("aria-label", value)
			else node.removeAttribute("aria-label")
		}
	})
})
