// Owned by lane A1 (`docs/hazel-ui.md`, "Phase 2: lanes"). The G1 renderer, moved here in C0.
import { svg } from "../../icons.ts"
import { definePrimitive, option } from "../define.ts"

export const primitive = definePrimitive("icon", ({ outer, self }) => {
	const node = outer("span")
	node.setAttribute("aria-hidden", "true")
	return self(node, (name, value) => {
		if (name !== "name") return
		option(node, "name", value)
		node.innerHTML = svg(String(value))
	})
})
