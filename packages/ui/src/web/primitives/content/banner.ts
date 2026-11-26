// Owned by lane A1 (`docs/hazel-ui.md`, "Phase 2: lanes").
import { glyph } from "../../icons.ts"
import { definePrimitive, option, part, type Primitive } from "../define.ts"
import { ensureStyles } from "./styles.ts"

/**
 * The kit's callout and the chat's new-messages bar. The content part holds the title, the
 * description, then the view's children and the `actions` slot (placed last by `styles.ts`).
 * `danger` is announced as an alert, the rest as a status, as the kit's.
 */
export const primitive = definePrimitive("banner", ({ document, tag, outer }) => {
	ensureStyles(document)
	const node = outer("div")
	node.setAttribute("role", "status")
	const icon = part(document, "span", "icon")
	icon.setAttribute("aria-hidden", "true")
	icon.hidden = true
	const content = part(document, "div", "content")
	const title = part(document, "p", "title")
	title.hidden = true
	const description = part(document, "p", "description")
	description.hidden = true
	content.append(title, description)
	const dismiss = part(document, "button", "dismiss")
	dismiss.setAttribute("type", "button")
	dismiss.setAttribute("aria-label", "Dismiss")
	dismiss.hidden = true
	glyph(dismiss, "close")
	node.append(icon, content, dismiss)
	const text = (target: HTMLElement, value: unknown) => {
		const next = typeof value === "string" ? value : ""
		target.textContent = next
		target.hidden = next === ""
	}
	const primitive: Primitive = {
		tag,
		outer: node,
		content,
		set: (name, value) => {
			if (name === "title") text(title, value)
			else if (name === "description") text(description, value)
			else if (name === "icon") {
				const named = typeof value === "string" ? value : undefined
				glyph(icon, named)
				icon.hidden = named === undefined
			} else if (name === "dismissible") {
				dismiss.hidden = value !== true
			} else if (name === "tone") {
				option(node, "tone", value)
				node.setAttribute("role", value === "danger" ? "alert" : "status")
			} else if (name === "style") option(node, "style", value)
		},
		events: undefined,
	}
	dismiss.addEventListener("click", () => {
		const events = primitive.events
		const handler = events?.handlers.dismiss
		if (events !== undefined && handler !== undefined) events.dispatch("dismiss", handler, {})
	})
	return primitive
})
