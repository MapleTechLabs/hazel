// Owned by lane A1 (`docs/hazel-ui.md`, "Phase 2: lanes").
import { definePrimitive, flag, option } from "../define.ts"

export const primitive = definePrimitive("text", ({ outer, self }) => {
	const node = outer("span")
	return self(node, (name, value) => {
		if (name === "strong" || name === "numeric" || name === "truncate") flag(node, name, value)
		else if (name === "role" || name === "tone") option(node, name, value)
	})
})
