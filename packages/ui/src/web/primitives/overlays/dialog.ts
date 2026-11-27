/**
 * `hz:dialog` on the web (lane A3): a modal card with an optional icon tile, a title, a description, its
 * children and the footer slots (`actions` at the end edge, `secondaryActions` at the start). The kit's
 * close button shows while the view listens to `dismiss`. `destructive` makes it an `alertdialog`.
 */
import { svg } from "../../icons.ts"
import { flag, option, part } from "../define.ts"
import { modalPrimitive } from "./modal.ts"
import { nextId, textOf } from "./overlay.ts"

export const primitive = modalPrimitive(
	"dialog",
	({ node, panel, header, title, dismiss, listens, beforeShow }) => {
		const document = panel.ownerDocument
		const icon = part(document, "div", "icon")
		icon.setAttribute("aria-hidden", "true")
		icon.hidden = true
		const heading = part(document, "div", "heading")
		const description = part(document, "p", "description")
		description.id = nextId("description")
		description.hidden = true
		heading.append(title, description)
		header.append(icon, heading)
		const close = part(document, "button", "close")
		close.setAttribute("type", "button")
		close.setAttribute("aria-label", "Close")
		close.innerHTML = svg("close")
		close.addEventListener("click", dismiss)
		panel.append(close)
		beforeShow(() => {
			close.hidden = !listens("dismiss")
		})
		return (name, value) => {
			if (name === "description") {
				description.textContent = textOf(value)
				description.hidden = description.textContent === ""
				if (description.hidden) panel.removeAttribute("aria-describedby")
				else panel.setAttribute("aria-describedby", description.id)
				return true
			}
			if (name === "destructive") {
				panel.setAttribute("role", value === true ? "alertdialog" : "dialog")
				flag(node, "destructive", value)
				return true
			}
			if (name === "icon") {
				icon.innerHTML = typeof value === "string" ? svg(value) : ""
				icon.hidden = typeof value !== "string"
				return true
			}
			if (name === "size" || name === "iconTone") {
				option(node, name === "size" ? "size" : "icon-tone", value)
				return true
			}
			return false
		}
	},
)
