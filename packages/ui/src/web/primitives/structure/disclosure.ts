// Owned by lane A4 (phase 4, W9). `hz:disclosure`: a header button that shows or hides the children
// (customers' `disclosure`, `ui/thought-line.ts`). The view owns `open`; a press raises `toggle {open}`.
import { glyph, svg } from "../../icons.ts"
import { loop } from "../../motion.ts"
import { definePrimitive, flag, option, part, type Primitive } from "../define.ts"
import { ensureSheet, fire, textOf } from "../list/runtime.ts"

const ROOT = '[data-hz="disclosure"]'
const BODY = `${ROOT} > [data-hz-part="body"]`

// The body is `contents`: the trailing slot ends the header's line, every other child takes a line
// of its own and is hidden while closed. The chevron turns a quarter when open.
const css = `
${BODY} > [data-hz]:not([data-hz-slot]) { flex: 1 0 100%; min-width: 0; }
${ROOT}:not([data-open]) > [data-hz-part="body"] > [data-hz]:not([data-hz-slot]) { display: none; }
${BODY} > [data-hz-slot="trailing"] { margin-inline-start: auto; }
${BODY} > [data-hz-slot="trailing"]:empty { display: none; }
${ROOT} > [data-hz-part="header"] { min-width: 0; cursor: pointer; }
${ROOT} > [data-hz-part="header"]:hover { color: var(--hz-color-fg); }
${ROOT} > [data-hz-part="header"]:hover > [data-hz-part="chevron"] { opacity: 1; }
${ROOT} > [data-hz-part="header"]:focus-visible { outline: 2px solid var(--hz-color-ring); outline-offset: 2px; }
${ROOT} > [data-hz-part="header"] > [data-hz-part="chevron"] > svg { display: block; width: 100%; height: 100%; }
${ROOT} > [data-hz-part="header"] > [data-hz-part="chevron"] { transition-property: transform, opacity; }
${ROOT}[data-open] > [data-hz-part="header"] > [data-hz-part="chevron"] { transform: rotate(90deg); }
${ROOT} > [data-hz-part="header"] > [data-hz-part="subtitle"]:empty { display: none; }
${ROOT} > [data-hz-part="header"] > [data-hz-part="icon"]:empty { display: none; }
/* With a glyph (the thought line), the chevron trails the title. */
${ROOT}[data-icon] > [data-hz-part="header"] > [data-hz-part="chevron"] { order: 1; }
${ROOT}[data-tone="danger"] > [data-hz-part="header"]:hover { color: var(--hz-color-danger); }
`

let counter = 0

export const primitive = definePrimitive("disclosure", ({ document, tag, outer }) => {
	ensureSheet(document, "disclosure", css)
	const node = outer("div")
	const header = part(document, "button", "header")
	header.setAttribute("type", "button")
	header.setAttribute("aria-expanded", "false")
	const chevron = part(document, "span", "chevron")
	chevron.setAttribute("aria-hidden", "true")
	chevron.innerHTML = svg("chevron-right")
	const title = part(document, "span", "title")
	const subtitle = part(document, "span", "subtitle")
	const icon = part(document, "span", "icon")
	icon.setAttribute("aria-hidden", "true")
	header.append(icon, chevron, title, subtitle)
	const body = part(document, "div", "body")
	body.id = `hz-disclosure-${++counter}`
	header.setAttribute("aria-controls", body.id)
	node.append(header, body)

	let open = false
	header.addEventListener("click", () => fire(primitive, "toggle", { open: !open }))

	const primitive: Primitive = {
		tag,
		outer: node,
		content: body,
		set: (name, value) => {
			if (name === "title") title.textContent = textOf(value)
			else if (name === "subtitle") subtitle.textContent = textOf(value)
			else if (name === "icon") {
				glyph(icon, typeof value === "string" ? value : undefined)
				flag(node, "icon", typeof value === "string")
			} else if (name === "tone") option(node, "tone", value)
			else if (name === "open") {
				open = value === true
				flag(node, "open", value)
				header.setAttribute("aria-expanded", String(open))
			} else if (name === "running") {
				flag(node, "running", value)
				loop(node, value === true)
				if (value === true) header.setAttribute("aria-busy", "true")
				else header.removeAttribute("aria-busy")
			}
		},
		events: undefined,
	}
	return primitive
})
