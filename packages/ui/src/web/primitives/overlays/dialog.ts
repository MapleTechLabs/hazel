/**
 * `hz:dialog` on the web (lane A3): a centred modal with a title, a description, its children and the
 * `actions` slot (drawn last, at the end edge). `destructive` makes it an `alertdialog`.
 */
import { flag, part } from "../define.ts"
import { modalPrimitive } from "./modal.ts"
import { nextId, textOf } from "./overlay.ts"

export const primitive = modalPrimitive("dialog", ({ node, panel, header }) => {
	const description = part(panel.ownerDocument, "p", "description")
	description.id = nextId("description")
	description.hidden = true
	header.append(description)
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
		return false
	}
})
