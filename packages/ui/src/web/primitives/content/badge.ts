// Owned by lane A1 (`docs/hazel-ui.md`, "Phase 2: lanes").
import { definePrimitive, flag, option } from "../define.ts"

export const primitive = definePrimitive("badge", ({ outer, self }) => {
	const node = outer("span")
	return self(node, (name, value) => {
		if (name === "label") node.textContent = typeof value === "string" ? value : ""
		else if (name === "pill") flag(node, "pill", value)
		else if (name === "tone" || name === "style" || name === "size") option(node, name, value)
	})
})
