// Owned by lane A1 (`docs/hazel-ui.md`, "Phase 2: lanes"). The G1 renderer, moved here in C0.
import { definePrimitive, flag, option } from "../define.ts"

export const primitive = definePrimitive("text", ({ outer, self }) => {
	const node = outer("span")
	return self(node, (name, value) => {
		if (name === "strong") flag(node, "strong", value)
		else if (name === "role" || name === "tone") option(node, name, value)
	})
})
