// Owned by lane A4 (`docs/hazel-ui.md`, "Phase 2: lanes"). The G1 renderer, moved here in C0.
import { definePrimitive, part } from "../define.ts"

export const primitive = definePrimitive("section", ({ document, tag, outer }) => {
	const node = outer("section")
	const title = part(document, "h2", "title")
	const content = part(document, "div", "content")
	node.append(title, content)
	return {
		tag,
		outer: node,
		content,
		set: (name, value) => {
			if (name === "title") {
				title.textContent = typeof value === "string" ? value : ""
				node.setAttribute("aria-label", title.textContent)
			}
		},
		events: undefined,
	}
})
