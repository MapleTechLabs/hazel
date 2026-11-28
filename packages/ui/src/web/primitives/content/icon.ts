// Owned by lane A1 (`docs/hazel-ui.md`, "Phase 2: lanes"). The G1 renderer, moved here in C0.
import { svg } from "../../icons.ts"
import { definePrimitive, flag, option } from "../define.ts"
import { ensureSheet } from "../list/runtime.ts"
import { ensureStyles } from "./styles.ts"

// `dot` (`ph2-view-glyph`, `view-look.ts` `viewGlyph`): a `size-2` round mark centred in the icon's
// box, in its ink. `tint` is a `tint-*` colour token; with none the dot is the muted tint.
const css = `
[data-hz="icon"][data-dot] { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
[data-hz="icon"][data-dot]:not([data-tint]) { color: var(--hz-color-tint-muted); }
[data-hz="icon"] > [data-hz-part="dot"] {
	width: var(--hz-space-2); height: var(--hz-space-2); border-radius: 9999px; background: currentColor;
}
`

// An icon outside an owner's slot or part draws at the icon size (`icon-standalone-size`).
export const primitive = definePrimitive("icon", ({ document, outer, self }) => {
	ensureStyles(document)
	ensureSheet(document, "icon", css)
	const node = outer("span")
	node.setAttribute("aria-hidden", "true")
	let name: string | undefined
	let dot = false
	const draw = () => {
		if (dot) {
			const mark = document.createElement("span")
			mark.dataset.hzPart = "dot"
			node.replaceChildren(mark)
		} else node.innerHTML = name === undefined ? "" : svg(name)
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
