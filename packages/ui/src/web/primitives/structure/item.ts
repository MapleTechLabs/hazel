// Owned by lane A4 (`docs/hazel-ui.md`, "Phase 2: lanes"). The G1 renderer, moved here in C0.
import { definePrimitive, part, flag } from "../define.ts"

export const primitive = definePrimitive("item", ({ document, tag, outer }) => {
	const node = outer("div")
	const content = part(document, "span", "content")
	const title = part(document, "span", "title")
	const badge = part(document, "span", "badge")
	badge.hidden = true
	let control: HTMLElement = part(document, "button", "control")
	control.setAttribute("type", "button")
	control.append(content, title, badge)
	node.append(control)
	let selected = false
	// Link vs button: a new control takes the same three parts, so the content parent never moves
	// out of the item and the renderer's nodes are untouched.
	const swap = (href: string | undefined) => {
		const wanted = href === undefined ? "BUTTON" : "A"
		if (control.tagName !== wanted) {
			const next = part(document, wanted.toLowerCase(), "control")
			if (wanted === "BUTTON") next.setAttribute("type", "button")
			next.append(...control.childNodes)
			control.replaceWith(next)
			control = next
		}
		if (href !== undefined) control.setAttribute("href", href)
		if (selected) control.setAttribute("aria-current", "page")
		else control.removeAttribute("aria-current")
	}
	return {
		tag,
		outer: node,
		content,
		set: (name, value) => {
			if (name === "title") title.textContent = typeof value === "string" ? value : ""
			else if (name === "badge") {
				badge.hidden = typeof value !== "number"
				badge.textContent = typeof value === "number" ? String(value) : ""
			} else if (name === "href") swap(typeof value === "string" ? value : undefined)
			else if (name === "selected") {
				selected = value === true
				flag(node, "selected", value)
				swap(control.getAttribute("href") ?? undefined)
			} else if (name === "emphasized") flag(node, "emphasized", value)
		},
		events: undefined,
	}
})
