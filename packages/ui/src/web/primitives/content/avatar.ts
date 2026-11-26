// Owned by lane A1 (`docs/hazel-ui.md`, "Phase 2: lanes"). The G1 renderer, moved here in C0.
import { definePrimitive } from "../define.ts"

export const primitive = definePrimitive("avatar", ({ outer, self }) => {
	const node = outer("span")
	node.setAttribute("aria-hidden", "true")
	return self(node, (name, value) => {
		if (name === "initials") node.textContent = typeof value === "string" ? value : ""
	})
})
