// Owned by lane A4 (`docs/hazel-ui.md`, "Phase 2: lanes"). The G1 renderer, moved here in C0.
import { definePrimitive, part } from "../define.ts"

export const primitive = definePrimitive("screen", ({ document, tag, outer }) => {
	const node = outer("main")
	const header = part(document, "header", "header")
	const title = part(document, "h1", "title")
	const content = part(document, "div", "content")
	header.append(title)
	node.append(header, content)
	return {
		tag,
		outer: node,
		content,
		set: (name, value) => {
			if (name === "title") title.textContent = typeof value === "string" ? value : ""
		},
		events: undefined,
	}
})
