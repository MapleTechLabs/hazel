/**
 * `hz:textField` in the DOM (G5): a label, a real `input`, a description and an error line. The input
 * owns its text while editing; Model `value`s go through the same revision rule as Swift (`revisions.ts`).
 * Enter submits (not while composing); `focus`, `blur` and `select` commands reach the input.
 */
// Owned by lane A2.
import { definePrimitive, flag, part, type Primitive } from "../define.ts"
import { fire, focusEvents, labelledField, revisioned } from "./field.ts"
import { ensureStyles } from "./styles.ts"

export const primitive = definePrimitive("textField", ({ document, tag, outer }) => {
	ensureStyles(document)
	const node = outer("div")
	const input = part(document, "input", "input") as HTMLInputElement
	input.type = "text"
	input.dataset.hzFocus = ""
	const field = labelledField(document, node, input)
	const events = () => primitive.events
	const text = revisioned(input, (change) => fire(events(), "change", { ...change }))
	focusEvents(input, events)
	input.addEventListener("keydown", (event) => {
		if (event.key !== "Enter" || event.isComposing) return
		event.preventDefault()
		fire(events(), "submit", { ...text.current() })
	})

	const primitive: Primitive = {
		tag,
		outer: node,
		content: node,
		set: (name, value) => {
			if (field.set(name, value)) return
			if (name === "value") text.receive(value)
			else if (name === "readOnly") {
				input.readOnly = value === true
				flag(node, "read-only", value)
			} else if (name === "required") {
				input.required = value === true
				field.marker.hidden = value !== true
				flag(node, "required", value)
			} else if (name === "monospace") {
				flag(node, "monospace", value)
				input.spellcheck = value !== true
			}
		},
		events: undefined,
	}
	return primitive
})
