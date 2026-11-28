// Owned by lane A1 (`docs/hazel-ui.md`, "Phase 2: lanes").
import { definePrimitive, flag, option } from "../define.ts"
import { ensureStyles } from "./styles.ts"

export const primitive = definePrimitive("text", ({ document, outer, self }) => {
	ensureStyles(document)
	const node = outer("span")
	return self(node, (name, value) => {
		if (
			name === "strong" ||
			name === "numeric" ||
			name === "truncate" ||
			name === "clamp" ||
			name === "dot"
		)
			flag(node, name, value)
		else if (name === "role" || name === "tone") option(node, name, value)
	})
})
