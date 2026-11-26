// Owned by lane A1 (`docs/hazel-ui.md`, "Phase 2: lanes"). The G1 renderer, moved here in C0.
import { definePrimitive } from "../define.ts"

export const primitive = definePrimitive("stack", ({ outer, self }) => {
	return self(outer("div"), () => {})
})
