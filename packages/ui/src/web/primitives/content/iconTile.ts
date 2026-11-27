// Owned by lane A1 (`docs/hazel-ui.md`, "Phase 2: lanes").
import { glyph } from "../../icons.ts"
import { ensureSheet } from "../list/runtime.ts"
import { definePrimitive, option, part, type Primitive } from "../define.ts"

// A mark's picture is a step larger than the glyph on the 40pt tile (`sourceMark` `md`: `size-6`).
const css = `
[data-hz="iconTile"] > img[data-hz-part="icon"] { object-fit: contain; }
[data-hz="iconTile"]:not([data-size]) > img[data-hz-part="icon"] { width: var(--hz-space-6); height: var(--hz-space-6); }
`

// Decoration beside a row's text (`activity-icon-tile`): hidden from assistive technology, as the kit's.
export const primitive = definePrimitive("iconTile", ({ document, tag, outer }) => {
	ensureSheet(document, "iconTile", css)
	const node = outer("span")
	node.setAttribute("aria-hidden", "true")
	let icon: HTMLElement = part(document, "span", "icon")
	node.append(icon)
	let name: string | undefined
	let image: string | undefined
	// The picture, else the glyph, in the one `icon` part.
	const draw = () => {
		const next = part(document, image === undefined ? "span" : "img", "icon")
		if (image === undefined) glyph(next, name)
		else {
			next.setAttribute("src", image)
			next.setAttribute("alt", "")
		}
		icon.replaceWith(next)
		icon = next
	}
	const primitive: Primitive = {
		tag,
		outer: node,
		content: node,
		set: (prop, value) => {
			const text = typeof value === "string" ? value : undefined
			if (prop === "name") {
				name = text
				draw()
			} else if (prop === "image") {
				image = text
				draw()
			} else if (prop === "tone" || prop === "size") option(node, prop, value)
		},
		events: undefined,
	}
	return primitive
})
