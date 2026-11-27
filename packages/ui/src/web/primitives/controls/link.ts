/**
 * `hz:link`: an `a href` (role `link`), or a `button` styled as a link when there is no `href`. A plain
 * click on a link the view handles (`press`) has its navigation cancelled, so only the Model navigates
 * (G2); a modified or middle click keeps the browser's own behaviour and raises no `press`.
 */
// Owned by lane A2.
import { glyph } from "../../icons.ts"
import { definePrimitive, option, part, type Primitive } from "../define.ts"
import { handles } from "./field.ts"
import { ensureStyles } from "./styles.ts"

const modified = (event: MouseEvent) =>
	event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey

export const primitive = definePrimitive("link", ({ document, tag, outer }) => {
	ensureStyles(document)
	const node = outer("span")
	const make = (tagName: string) => {
		const next = part(document, tagName, "control")
		next.dataset.hzFocus = ""
		next.addEventListener("click", onClick)
		return next
	}
	let control: HTMLElement = make("button")
	let href: string | undefined
	let text = ""
	let icon: string | undefined

	const draw = () => {
		const wanted = href === undefined ? "BUTTON" : "A"
		if (control.tagName !== wanted) {
			const next = make(wanted.toLowerCase())
			control.replaceWith(next)
			control = next
		}
		if (href === undefined) control.setAttribute("type", "button")
		else control.setAttribute("href", href)
		control.textContent = text
		// A leading icon (`p4-channel-settings-header`), decorative: the label names the link.
		if (icon !== undefined) {
			const mark = part(document, "span", "icon")
			mark.setAttribute("aria-hidden", "true")
			glyph(mark, icon)
			control.prepend(mark)
		}
	}
	function onClick(event: MouseEvent) {
		if (control.tagName !== "A") return
		if (modified(event)) event.stopPropagation()
		else if (handles(primitive.events, "press")) event.preventDefault()
	}
	control.setAttribute("type", "button")
	node.append(control)

	const primitive: Primitive = {
		tag,
		outer: node,
		content: node,
		set: (name, value) => {
			if (name === "label") text = typeof value === "string" ? value : ""
			else if (name === "href") href = typeof value === "string" ? value : undefined
			else if (name === "icon") icon = typeof value === "string" ? value : undefined
			else if (name === "tone") return option(node, "tone", value)
			else return
			draw()
		},
		events: undefined,
	}
	return primitive
})
