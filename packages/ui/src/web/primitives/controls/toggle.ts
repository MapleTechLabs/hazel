/**
 * `hz:toggle`: a switch, a `button role=switch` (Space and Enter flip it), or with style `checkbox` a
 * `button role=checkbox` before its label whose `indeterminate` is `aria-checked=mixed`. Named by its
 * label and described by its description; pressing the label flips it too. Controlled: a press raises
 * `change {checked}` with the next value (mixed goes to checked) and it moves when the Model sends `checked`.
 */
// Owned by lane A2.
import { svg } from "../../icons.ts"
import { definePrimitive, flag, option, part, type Primitive } from "../define.ts"
import { ensureChoiceStyles } from "./choice-styles.ts"
import { fire, uniqueId } from "./field.ts"
import { ensureStyles } from "./styles.ts"

export const primitive = definePrimitive("toggle", ({ document, tag, outer }) => {
	ensureStyles(document)
	ensureChoiceStyles(document)
	const node = outer("div")
	const text = part(document, "span", "text")
	const label = part(document, "label", "label") as HTMLLabelElement
	const description = part(document, "span", "description")
	description.hidden = true
	const control = part(document, "button", "control") as HTMLButtonElement
	const thumb = part(document, "span", "thumb")
	const box = part(document, "span", "box")
	box.hidden = true
	box.setAttribute("aria-hidden", "true")
	const mark = part(document, "span", "mark")
	box.append(mark)
	control.type = "button"
	control.id = uniqueId("toggle")
	control.dataset.hzFocus = ""
	label.id = uniqueId("toggle-label")
	label.htmlFor = control.id
	description.id = uniqueId("toggle-description")
	control.setAttribute("aria-labelledby", label.id)
	control.append(thumb, box)
	text.append(label, description)
	node.append(text, control)

	let checked = false
	let indeterminate = false
	let checkbox = false
	control.addEventListener("click", () =>
		fire(primitive.events, "change", { checked: indeterminate ? true : !checked }),
	)

	const draw = () => {
		control.setAttribute("role", checkbox ? "checkbox" : "switch")
		control.setAttribute("aria-checked", checkbox && indeterminate ? "mixed" : String(checked))
		thumb.hidden = checkbox
		box.hidden = !checkbox
		// A checkbox leads its label (`checkboxLayoutStyles`); a switch trails it.
		if (checkbox && node.firstElementChild !== control) node.prepend(control)
		else if (!checkbox && node.lastElementChild !== control) node.append(control)
		const icon = !checkbox ? undefined : indeterminate ? "minus" : checked ? "check" : undefined
		mark.hidden = icon === undefined
		mark.innerHTML = icon === undefined ? "" : svg(icon)
	}

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
			} else if (name === "disabled") {
				control.disabled = value === true
				flag(node, "disabled", value)
			} else {
				if (name === "checked") {
					checked = value === true
					flag(node, "selected", value)
				} else if (name === "indeterminate") {
					indeterminate = value === true
					flag(node, "indeterminate", value)
				} else if (name === "style") {
					checkbox = value === "checkbox"
					option(node, "style", value)
				} else return
				draw()
			}
		},
		events: undefined,
	}
	draw()
	return primitive
})
