// Owned by lane A1 (`docs/hazel-ui.md`, "Phase 2: lanes"). The G1 renderer, moved here in C0.
import { definePrimitive, option } from "../define.ts"

export const primitive = definePrimitive("slot", ({ outer, self }) => {
	const node = outer("span")
	return self(node, (name, value) => {
		if (name !== "name") return
		option(node, "name", value)
		// What the owner's recipe targets (`[data-hz-slot=leading]`).
		option(node, "hz-slot", value)
	})
})
