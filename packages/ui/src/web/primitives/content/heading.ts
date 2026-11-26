// Owned by lane A1 (`docs/hazel-ui.md`, "Phase 2: lanes").
import { definePrimitive, option } from "../define.ts"

// The element is fixed at create, so the level is ARIA's, not the tag name's (`h1`..`h3`).
export const primitive = definePrimitive("heading", ({ outer, self }) => {
	const node = outer("div")
	node.setAttribute("role", "heading")
	node.setAttribute("aria-level", "2")
	return self(node, (name, value) => {
		if (name !== "level") return
		option(node, "level", value)
		node.setAttribute("aria-level", typeof value === "string" ? value : "2")
	})
})
