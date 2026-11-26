// Owned by lane A1 (`docs/hazel-ui.md`, "Phase 2: lanes").
import { definePrimitive, option, part, type Primitive } from "../define.ts"
import { ensureStyles } from "./styles.ts"

// The avatars are the renderer's children (the content parent is the outer node), so they insert
// after the `+N` count; `order` draws the count last. `pair` places two avatars diagonally.
export const primitive = definePrimitive("avatarStack", ({ document, tag, outer }) => {
	ensureStyles(document)
	const node = outer("span")
	const overflow = part(document, "span", "overflow")
	overflow.hidden = true
	overflow.style.order = "1"
	node.append(overflow)
	const primitive: Primitive = {
		tag,
		outer: node,
		content: node,
		set: (name, value) => {
			if (name === "layout") option(node, "layout", value)
			if (name !== "overflow") return
			const count = typeof value === "number" && value > 0 ? value : 0
			overflow.hidden = count === 0
			overflow.textContent = count === 0 ? "" : `+${count}`
			overflow.setAttribute("aria-label", count === 0 ? "" : `${count} more`)
		},
		events: undefined,
	}
	return primitive
})
