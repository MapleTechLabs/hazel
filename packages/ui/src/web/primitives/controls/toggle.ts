/**
 * `hz:toggle`: a switch, a `button role=switch` (Space and Enter flip it) named by its label and
 * described by its description; pressing the label flips it too. Controlled: a press raises
 * `change {checked}` with the next value and the switch moves when the Model sends `checked`.
 */
// Owned by lane A2.
import { definePrimitive, flag, part, type Primitive } from "../define.ts"
import { fire, uniqueId } from "./field.ts"
import { ensureStyles } from "./styles.ts"

export const primitive = definePrimitive("toggle", ({ document, tag, outer }) => {
	ensureStyles(document)
	const node = outer("div")
	const text = part(document, "span", "text")
	const label = part(document, "label", "label") as HTMLLabelElement
	const description = part(document, "span", "description")
	description.hidden = true
	const control = part(document, "button", "control") as HTMLButtonElement
	const thumb = part(document, "span", "thumb")
	control.type = "button"
	control.id = uniqueId("toggle")
	control.dataset.hzFocus = ""
	control.setAttribute("role", "switch")
	control.setAttribute("aria-checked", "false")
	label.id = uniqueId("toggle-label")
	label.htmlFor = control.id
	description.id = uniqueId("toggle-description")
	control.setAttribute("aria-labelledby", label.id)
	control.append(thumb)
	text.append(label, description)
	node.append(text, control)

	let checked = false
	control.addEventListener("click", () => fire(primitive.events, "change", { checked: !checked }))

	const primitive: Primitive = {
		tag,
		outer: node,
		content: node,
		set: (name, value) => {
			if (name === "label") label.textContent = typeof value === "string" ? value : ""
			else if (name === "description") {
				description.hidden = typeof value !== "string"
				description.textContent = typeof value === "string" ? value : ""
				if (typeof value === "string") control.setAttribute("aria-describedby", description.id)
				else control.removeAttribute("aria-describedby")
			} else if (name === "checked") {
				checked = value === true
				control.setAttribute("aria-checked", String(checked))
				flag(node, "selected", value)
			} else if (name === "disabled") {
				control.disabled = value === true
				flag(node, "disabled", value)
			}
		},
		events: undefined,
	}
	return primitive
})
