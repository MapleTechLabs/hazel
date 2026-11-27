// Owned by lane A4 (phase 4, W9). `hz:actionBar`: a toolbar over the bottom edge of its page while
// `open` (today's customers `bulkBar`): the label pill, the `actions` slot, and a close that raises `dismiss`.
import { svg } from "../../icons.ts"
import { onShow } from "../../motion.ts"
import { definePrimitive, flag, part, type Primitive } from "../define.ts"
import { ensureSheet, fire, listens, textOf } from "../list/runtime.ts"

const ROOT = '[data-hz="actionBar"]'

// Today: `fixed bottom-6 left-1/2 z-40 -translate-x-1/2`; here over the nearest positioned ancestor
// (a `screen`), so it stays inside the page it acts on. The phone spans the width and wraps.
const css = `
${ROOT} { position: absolute; bottom: var(--hz-space-6); left: 50%; translate: -50% 0; z-index: 40; max-width: calc(100% - var(--hz-space-4)); }
${ROOT}[hidden] { display: none; }
${ROOT} > [data-hz-part="label"]:empty { display: none; }
${ROOT} > [data-hz-part="dismiss"] { order: 1; display: inline-flex; align-items: center; justify-content: center; }
${ROOT} > [data-hz-part="dismiss"] > svg { width: var(--hz-space-4); height: var(--hz-space-4); }
${ROOT} > [data-hz-part="dismiss"]:is(:hover, :active) { background: var(--hz-color-wash); color: var(--hz-color-fg); }
${ROOT} > [data-hz-part="dismiss"]:focus-visible { outline: 2px solid var(--hz-color-ring); outline-offset: -2px; }
@media (width < 40rem) {
	${ROOT} { left: var(--hz-space-2); right: var(--hz-space-2); bottom: var(--hz-space-4); translate: none; max-width: none; flex-wrap: wrap; justify-content: center; }
}
`

export const primitive = definePrimitive("actionBar", ({ document, tag, outer }) => {
	ensureSheet(document, "actionBar", css)
	const node = outer("div")
	node.setAttribute("role", "toolbar")
	node.hidden = true
	onShow(node, "enter")
	const label = part(document, "span", "label")
	label.setAttribute("role", "status")
	const dismiss = part(document, "button", "dismiss")
	dismiss.setAttribute("type", "button")
	dismiss.setAttribute("aria-label", "Clear selection")
	dismiss.innerHTML = svg("close")
	dismiss.addEventListener("click", () => fire(primitive, "dismiss"))
	node.append(label, dismiss)

	// Escape inside the bar is its close, as the dismiss button.
	node.addEventListener("keydown", (event) => {
		if (event.key !== "Escape" || !listens(primitive, "dismiss")) return
		if (fire(primitive, "dismiss")) event.preventDefault()
	})

	const primitive: Primitive = {
		tag,
		outer: node,
		content: node,
		set: (name, value) => {
			if (name === "open") {
				node.hidden = value !== true
				flag(node, "open", value)
			} else if (name === "label") {
				const text = textOf(value)
				label.textContent = text
				if (text === "") node.removeAttribute("aria-label")
				else node.setAttribute("aria-label", text)
			}
		},
		events: undefined,
	}
	return primitive
})
