/**
 * `hz:textArea`: a labelled multi-line field on a real `textarea`, with the G5 revision pair. Enter is a
 * new line; Cmd or Ctrl+Enter submits. `focus`, `blur` and `select` commands reach the textarea.
 */
// Owned by lane A2.
import { definePrimitive, part, type Primitive } from "../define.ts"
import { fire, focusEvents, labelledField, revisioned } from "./field.ts"
import { ensureStyles } from "./styles.ts"

export const primitive = definePrimitive("textArea", ({ document, tag, outer }) => {
	ensureStyles(document)
	const node = outer("div")
	const area = part(document, "textarea", "input") as HTMLTextAreaElement
	area.rows = 3
	area.dataset.hzFocus = ""
	const field = labelledField(document, node, area)
	const events = () => primitive.events
	const text = revisioned(area, (change) => fire(events(), "change", { ...change }))
	focusEvents(area, events)
	area.addEventListener("keydown", (event) => {
		if (event.key !== "Enter" || event.isComposing || !(event.metaKey || event.ctrlKey)) return
		event.preventDefault()
		fire(events(), "submit", { ...text.current() })
	})

	const primitive: Primitive = {
		tag,
		outer: node,
		content: node,
		set: (name, value) => {
			if (!field.set(name, value) && name === "value") text.receive(value)
		},
		events: undefined,
	}
	return primitive
})
