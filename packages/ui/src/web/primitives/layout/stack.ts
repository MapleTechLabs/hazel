// Owned by lane A1 (`docs/hazel-ui.md`, "Phase 2: lanes").
import { definePrimitive, flag, option } from "../define.ts"

export const primitive = definePrimitive("stack", ({ outer, self }) => {
	const node = outer("div")
	return self(node, (name, value) => {
		if (name === "axis" || name === "density" || name === "align" || name === "inset")
			option(node, name, value)
		else if (name === "wrap") flag(node, "wrap", value)
		else if (name === "regularOnly") flag(node, "regular-only", value)
	})
})
