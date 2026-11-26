// Owned by lane A1 (`docs/hazel-ui.md`, "Phase 2: lanes").
import { glyph } from "../../icons.ts"
import { definePrimitive, option, part, type Primitive } from "../define.ts"

// Decoration beside a row's text (`activity-icon-tile`): hidden from assistive technology, as the kit's.
export const primitive = definePrimitive("iconTile", ({ document, tag, outer }) => {
	const node = outer("span")
	node.setAttribute("aria-hidden", "true")
	const icon = part(document, "span", "icon")
	node.append(icon)
	const primitive: Primitive = {
		tag,
		outer: node,
		content: node,
		set: (name, value) => {
			if (name === "name") glyph(icon, typeof value === "string" ? value : undefined)
			else if (name === "tone") option(node, "tone", value)
		},
		events: undefined,
	}
	return primitive
})
