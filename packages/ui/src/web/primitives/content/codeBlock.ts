// Owned by lane A1 (`docs/hazel-ui.md`, "Phase 2: lanes").
import { glyph } from "../../icons.ts"
import { definePrimitive, flag, part, type Primitive } from "../define.ts"
import { highlight } from "./code.ts"
import { ensureStyles } from "./styles.ts"

/** How long the copy button reads "Copied" (today's copy buttons swap to a check for as long). */
const COPIED_MS = 2000

export const primitive = definePrimitive("codeBlock", ({ document, tag, outer }) => {
	ensureStyles(document)
	const node = outer("div")
	const header = part(document, "div", "header")
	header.hidden = true
	const title = part(document, "span", "title")
	const copy = part(document, "button", "copy")
	copy.setAttribute("type", "button")
	copy.hidden = true
	const copyIcon = part(document, "span", "copyIcon")
	copyIcon.setAttribute("aria-hidden", "true")
	const copyLabel = document.createElement("span")
	copy.append(copyIcon, copyLabel)
	header.append(title, copy)
	const pre = part(document, "pre", "code")
	const code = document.createElement("code")
	pre.append(code)
	node.append(header, pre)
	let source = ""
	let language = ""
	let reset: ReturnType<typeof setTimeout> | undefined
	const copied = (done: boolean) => {
		flag(copy, "copied", done)
		glyph(copyIcon, done ? "check" : "copy")
		copyLabel.textContent = done ? "Copied" : "Copy"
	}
	copied(false)
	const draw = () => {
		if (language === "") delete code.dataset.language
		else code.dataset.language = language
		code.replaceChildren(...highlight(document, source, language))
	}
	const drawHeader = () => {
		header.hidden = title.textContent === "" && copy.hidden
	}
	const primitive: Primitive = {
		tag,
		outer: node,
		content: node,
		set: (name, value) => {
			const text = typeof value === "string" ? value : ""
			if (name === "code") {
				source = text
				draw()
			} else if (name === "language") {
				language = text
				draw()
			} else if (name === "title") {
				title.textContent = text
				drawHeader()
			} else if (name === "copyable") {
				copy.hidden = value !== true
				drawHeader()
			} else if (name === "wrap") flag(node, "wrap", value)
		},
		events: undefined,
	}
	copy.addEventListener("click", () => {
		const events = primitive.events
		const handler = events?.handlers.copy
		if (events === undefined || handler === undefined) return
		events.dispatch("copy", handler, {})
		copied(true)
		if (reset !== undefined) clearTimeout(reset)
		reset = setTimeout(() => copied(false), COPIED_MS)
	})
	return primitive
})
