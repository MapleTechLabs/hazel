/**
 * What the text controls share (lane A2): a real `input` or `textarea` that owns its text while editing,
 * Model `value`s through the G5 revision rule (`native/revisions.ts`), and the parts a labelled field
 * draws. No `primitive` export, so the registry glob skips this file.
 */
import * as Revisions from "../../../native/revisions.ts"
import { type Events, flag, part, type Plain } from "../define.ts"

let counter = 0
/** A document-unique id for ARIA wiring. */
export const uniqueId = (name: string) => `hz-${name}-${++counter}`

const textOf = (value: Plain) => (typeof value === "string" ? value : "")

/** Raises `event` with `payload` when the view handles it; false when it does not. */
export const fire = (events: Events | undefined, event: string, payload: Plain): boolean => {
	const handler = events?.handlers[event]
	return handler !== undefined && events !== undefined && events.dispatch(event, handler, payload)
}

export const handles = (events: Events | undefined, event: string) => events?.handlers[event] !== undefined

export type Control = HTMLInputElement | HTMLTextAreaElement

/**
 * The revision pair over one control: `edit` on each `input` event, `receive` for a `value` prop.
 * `onChange` sends a change (local edit or rebase); `current` is what `submit` sends.
 */
export const revisioned = (control: Control, onChange: (change: Revisions.Change) => void) => {
	let field = Revisions.initial
	control.addEventListener("input", () => {
		const next = Revisions.edit(field, control.value)
		field = next.field
		if (next.change !== undefined) onChange(next.change)
	})
	return {
		current: () => Revisions.current(field),
		receive: (value: Plain) => {
			const incoming = Revisions.decode(value)
			if (incoming === undefined) return
			const next = Revisions.receive(field, incoming)
			field = next.field
			if (control.value !== field.text) control.value = field.text
			if (next.change !== undefined) onChange(next.change)
		},
	}
}

/** `aria-describedby` from the description and error lines that are showing. */
const describe = (control: Control, lines: ReadonlyArray<HTMLElement>) => {
	const ids = lines.filter((line) => !line.hidden).map((line) => line.id)
	if (ids.length > 0) control.setAttribute("aria-describedby", ids.join(" "))
	else control.removeAttribute("aria-describedby")
}

/**
 * A labelled field (textField, textArea): `label > (caption, control)`, then description and error
 * lines wired to the control. `set` handles the props they share and returns false for the rest.
 */
export const labelledField = (document: Document, outer: HTMLElement, control: Control) => {
	const label = part(document, "label", "label")
	const caption = part(document, "span", "caption")
	const marker = part(document, "span", "required")
	marker.textContent = "*"
	marker.setAttribute("aria-hidden", "true")
	marker.hidden = true
	const description = part(document, "p", "description")
	description.id = uniqueId("description")
	description.hidden = true
	const error = part(document, "p", "error")
	error.id = uniqueId("error")
	error.hidden = true
	label.append(caption, marker, control)
	outer.append(label, description, error)

	const line = (node: HTMLElement, value: Plain) => {
		node.hidden = typeof value !== "string"
		node.textContent = textOf(value)
		describe(control, [description, error])
	}
	const set = (name: string, value: Plain): boolean => {
		if (name === "label") caption.textContent = textOf(value)
		else if (name === "placeholder") control.placeholder = textOf(value)
		else if (name === "description") line(description, value)
		else if (name === "error") {
			line(error, value)
			flag(outer, "invalid", typeof value === "string")
			if (typeof value === "string") control.setAttribute("aria-invalid", "true")
			else control.removeAttribute("aria-invalid")
		} else if (name === "disabled") {
			control.disabled = value === true
			flag(outer, "disabled", value)
		} else return false
		return true
	}
	return { label, caption, marker, set }
}

/** `focus` and `blur` events from the control, when the view handles them. */
export const focusEvents = (control: Control, events: () => Events | undefined) => {
	control.addEventListener("focus", () => fire(events(), "focus", {}))
	control.addEventListener("blur", () => fire(events(), "blur", {}))
}
