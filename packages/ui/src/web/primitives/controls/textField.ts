/**
 * `hz:textField` in the DOM (G5): a label, the field's box (`control`: an optional prefix, a real
 * `input`, an optional suffix, the reveal and copy buttons), a description and an error line. The
 * input owns its text while editing; Model `value`s go through the same revision rule as Swift
 * (`revisions.ts`). Enter submits (not while composing); `focus`, `blur` and `select` reach the input.
 */
// Owned by lane A2.
import type { InputKind } from "../../../vocabulary/options.ts"
import { glyph } from "../../icons.ts"
import { definePrimitive, flag, option, part, type Primitive } from "../define.ts"
import { fire, focusEvents, labelledField, revisioned, uniqueId } from "./field.ts"
import { ensureStyles } from "./styles.ts"

/**
 * What each kind sets on the input. Email and number stay `type=text` with an `inputmode`: browsers
 * refuse `setSelectionRange` on `email` and `number` inputs, and the revision pair and the `select`
 * command need it. `url` keeps its type (selection works there).
 */
const kinds = {
	text: { type: "text", inputMode: "text" },
	email: { type: "text", inputMode: "email", autocomplete: "email" },
	url: { type: "url", inputMode: "url", autocomplete: "url" },
	number: { type: "text", inputMode: "decimal" },
} as const satisfies Readonly<
	Record<InputKind, { readonly type: string; readonly inputMode: string; readonly autocomplete?: string }>
>

const isKind = (value: unknown): value is InputKind => typeof value === "string" && value in kinds

/** How long the copy button shows its check after a press, as the kit's copy buttons do. */
const COPIED_MS = 1500

export const primitive = definePrimitive("textField", ({ document, tag, outer }) => {
	ensureStyles(document)
	const node = outer("div")
	const input = part(document, "input", "input") as HTMLInputElement
	input.type = "text"
	input.dataset.hzFocus = ""
	const field = labelledField(document, node, input)
	field.caption.id = uniqueId("caption")
	// Named by the caption alone, so the prefix, suffix and buttons in the label never join the name.
	input.setAttribute("aria-labelledby", field.caption.id)
	const control = part(document, "span", "control")
	const prefix = part(document, "span", "prefix")
	const suffix = part(document, "span", "suffix")
	prefix.hidden = true
	suffix.hidden = true
	const reveal = part(document, "button", "reveal") as HTMLButtonElement
	reveal.type = "button"
	reveal.hidden = true
	input.id = uniqueId("input")
	reveal.setAttribute("aria-controls", input.id)
	const copy = part(document, "button", "copy") as HTMLButtonElement
	copy.type = "button"
	copy.hidden = true
	input.replaceWith(control)
	control.append(prefix, input, suffix, reveal, copy)
	// The prefix and suffix describe the value (`hazel.app/`, `minutes`), so a screen reader hears them.
	prefix.id = uniqueId("prefix")
	suffix.id = uniqueId("suffix")

	const events = () => primitive.events
	const text = revisioned(input, (change) => fire(events(), "change", { ...change }))
	focusEvents(input, events)
	input.addEventListener("keydown", (event) => {
		if (event.key !== "Enter" || event.isComposing) return
		event.preventDefault()
		fire(events(), "submit", { ...text.current() })
	})

	let kind: InputKind = "text"
	let secret = false
	let revealed = false
	let copiedTimer: ReturnType<typeof setTimeout> | undefined
	const drawType = () => {
		const spec = kinds[kind]
		input.type = secret && !revealed ? "password" : spec.type
		input.inputMode = spec.inputMode
		const autocomplete = secret ? "off" : "autocomplete" in spec ? spec.autocomplete : undefined
		if (autocomplete !== undefined) input.setAttribute("autocomplete", autocomplete)
		else input.removeAttribute("autocomplete")
		const literal = secret || kind === "email" || kind === "url" || kind === "number"
		input.spellcheck = !literal && !node.hasAttribute("data-monospace")
		if (literal) input.setAttribute("autocapitalize", "off")
		else input.removeAttribute("autocapitalize")
		option(node, "input-kind", kind === "text" ? undefined : kind)
	}
	const drawReveal = () => {
		reveal.setAttribute("aria-label", revealed ? "Hide" : "Show")
		reveal.setAttribute("aria-pressed", String(revealed))
		glyph(reveal, revealed ? "eye-off" : "eye")
		reveal.firstElementChild?.setAttribute("aria-hidden", "true")
		flag(node, "revealed", revealed)
		drawType()
	}
	const drawCopy = (copied: boolean) => {
		copy.setAttribute("aria-label", copied ? "Copied" : "Copy")
		glyph(copy, copied ? "check" : "copy")
		copy.firstElementChild?.setAttribute("aria-hidden", "true")
		flag(node, "copied", copied)
	}
	const describeAdornments = () => {
		const ids = [prefix, suffix].filter((each) => !each.hidden).map((each) => each.id)
		const others = (input.getAttribute("aria-describedby") ?? "")
			.split(" ")
			.filter((id) => id !== "" && id !== prefix.id && id !== suffix.id)
		const all = [...ids, ...others]
		if (all.length > 0) input.setAttribute("aria-describedby", all.join(" "))
		else input.removeAttribute("aria-describedby")
	}
	drawReveal()
	drawCopy(false)

	// Pressing a button in the box keeps the caret where it was (the kit's `preventFocusOnPress`).
	for (const button of [reveal, copy])
		button.addEventListener("mousedown", (event) => {
			if (document.activeElement === input) event.preventDefault()
		})
	reveal.addEventListener("click", (event) => {
		event.preventDefault()
		revealed = !revealed
		drawReveal()
	})
	copy.addEventListener("click", (event) => {
		event.preventDefault()
		if (!fire(events(), "copy", {})) return
		drawCopy(true)
		if (copiedTimer !== undefined) clearTimeout(copiedTimer)
		copiedTimer = setTimeout(() => {
			copiedTimer = undefined
			drawCopy(false)
		}, COPIED_MS)
	})

	const adornment = (target: HTMLElement, value: unknown, name: string) => {
		target.hidden = typeof value !== "string"
		target.textContent = typeof value === "string" ? value : ""
		flag(node, name, typeof value === "string")
		describeAdornments()
	}

	const primitive: Primitive = {
		tag,
		outer: node,
		content: node,
		set: (name, value) => {
			if (field.set(name, value)) {
				if (name === "description" || name === "error") describeAdornments()
				if (name === "disabled") reveal.disabled = copy.disabled = value === true
				return
			}
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
				drawType()
			} else if (name === "inputKind") {
				kind = isKind(value) ? value : "text"
				drawType()
			} else if (name === "secret") {
				secret = value === true
				reveal.hidden = !secret
				if (!secret) revealed = false
				flag(node, "secret", value)
				drawReveal()
			} else if (name === "copyable") {
				copy.hidden = value !== true
				flag(node, "copyable", value)
			} else if (name === "prefix") adornment(prefix, value, "prefixed")
			else if (name === "suffix") adornment(suffix, value, "suffixed")
		},
		events: undefined,
	}
	return primitive
})
