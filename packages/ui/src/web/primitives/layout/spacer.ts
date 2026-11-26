// Owned by lane A1 (`docs/hazel-ui.md`, "Phase 2: lanes").
import { definePrimitive } from "../define.ts"

export const primitive = definePrimitive("spacer", ({ outer, self }) => {
	const node = outer("div")
	node.setAttribute("aria-hidden", "true")
	return self(node, () => {})
})
