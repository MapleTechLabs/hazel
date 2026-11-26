/**
 * `hz:textField` in the DOM (G5): a label, a real `input` and an error line. The input owns its text
 * while editing; Model `value`s go through the same revision rule as Swift (`native/revisions.ts`).
 */
// Owned by lane A2. The G5 renderer, moved here in C0.
import * as Revisions from "../../../native/revisions.ts"
import { definePrimitive, type Primitive } from "../define.ts"

const createTextField = (document: Document, outer: HTMLElement): Primitive => {
	const part = (tagName: string, name: string) => {
		const node = document.createElement(tagName)
		node.dataset.hzPart = name
		return node
	}
	const label = part("label", "label")
	const caption = part("span", "caption")
	const input = part("input", "input") as HTMLInputElement
	input.type = "text"
	const error = part("p", "error")
	error.hidden = true
	error.id = `hz-error-${Math.random().toString(36).slice(2)}`
	label.append(caption, input)
	outer.append(label, error)

	let field = Revisions.initial
	const send = (event: "change" | "submit", payload: Revisions.Change) => {
		const handler = primitive.events?.handlers[event]
		return handler !== undefined && primitive.events!.dispatch(event, handler, payload)
	}
	input.addEventListener("input", () => {
		const next = Revisions.edit(field, input.value)
		field = next.field
		if (next.change !== undefined) send("change", next.change)
	})
	input.addEventListener("keydown", (event) => {
		if (event.key !== "Enter" || event.isComposing) return
		event.preventDefault()
		send("submit", Revisions.current(field))
	})

	const primitive: Primitive = {
		tag: "hz:textField",
		outer,
		content: outer,
		set: (name, value) => {
			if (name === "label") caption.textContent = typeof value === "string" ? value : ""
			else if (name === "placeholder") input.placeholder = typeof value === "string" ? value : ""
			else if (name === "error") {
				error.hidden = typeof value !== "string"
				error.textContent = typeof value === "string" ? value : ""
				if (typeof value === "string") {
					input.setAttribute("aria-invalid", "true")
					input.setAttribute("aria-describedby", error.id)
				} else {
					input.removeAttribute("aria-invalid")
					input.removeAttribute("aria-describedby")
				}
			} else if (name === "value") {
				const incoming = Revisions.decode(value)
				if (incoming === undefined) return
				const next = Revisions.receive(field, incoming)
				field = next.field
				if (input.value !== field.text) input.value = field.text
				if (next.change !== undefined) send("change", next.change)
			}
		},
		events: undefined,
	}
	return primitive
}

export const primitive = definePrimitive("textField", ({ document, outer }) =>
	createTextField(document, outer("div")),
)
