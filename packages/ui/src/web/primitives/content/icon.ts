// Owned by lane A1 (`docs/hazel-ui.md`, "Phase 2: lanes"). The G1 renderer, moved here in C0.
import { svg } from "../../icons.ts"
import { definePrimitive, flag, option } from "../define.ts"
import { ensureSheet } from "../list/runtime.ts"
import { ensureStyles } from "./styles.ts"

// `dot` (`ph2-view-glyph`, `view-look.ts` `viewGlyph`): a glyph like any other on the icons' 18pt
// grid, so it sizes and aligns wherever an icon does: a round mark half the box wide (`size-2` in a
// `size-4` box), in the icon's ink. `tint` is a `tint-*` colour token; with none the dot is muted.
const DOT =
	'<svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="9" cy="9" r="4.5" fill="currentColor"/></svg>'
const css = `[data-hz="icon"][data-dot]:not([data-tint]) { color: var(--hz-color-tint-muted); }`

// An icon outside an owner's slot or part draws at the icon size (`icon-standalone-size`).
export const primitive = definePrimitive("icon", ({ document, outer, self }) => {
	ensureStyles(document)
	ensureSheet(document, "icon", css)
	const node = outer("span")
	node.setAttribute("aria-hidden", "true")
	let name: string | undefined
	let dot = false
	const draw = () => {
		node.innerHTML = dot ? DOT : name === undefined ? "" : svg(name)
	}
	return self(node, (prop, value) => {
		if (prop === "name") {
			name = typeof value === "string" ? value : undefined
			option(node, "name", value)
			draw()
		} else if (prop === "dot") {
			dot = value === true
			flag(node, "dot", value)
			draw()
		} else if (prop === "tint") {
			// Inline, so it wins over the ink a row's slot gives its icons (a selected nav row's brand ink).
			const tint = typeof value === "string" ? value : undefined
			node.style.color = tint === undefined ? "" : `var(--hz-color-tint-${tint})`
			flag(node, "tint", tint !== undefined)
		}
	})
})
