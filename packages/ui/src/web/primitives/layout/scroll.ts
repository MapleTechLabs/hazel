// Owned by lane A1 (`docs/hazel-ui.md`, "Phase 2: lanes").
import { definePrimitive, option } from "../define.ts"

// The recipe scrolls along `axis` (`recipe-overflow`).
export const primitive = definePrimitive("scroll", ({ outer, self }) => {
	const node = outer("div")
	return self(node, (name, value) => {
		if (name === "axis") option(node, "axis", value)
	})
})
