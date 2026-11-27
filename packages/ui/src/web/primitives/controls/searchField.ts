/**
 * `hz:searchField`: a search box (`input type=search`, role `searchbox`) with a leading search icon and
 * the G5 revision pair. Enter submits; Escape clears through the same `change` path as typing.
 */
// Owned by lane A2.
import { svg } from "../../icons.ts"
import { definePrimitive, option, part, type Primitive } from "../define.ts"
import { fire, revisioned } from "./field.ts"
import { ensureStyles } from "./styles.ts"

export const primitive = definePrimitive("searchField", ({ document, tag, outer }) => {
	ensureStyles(document)
	const node = outer("div")
	const icon = part(document, "span", "icon")
	icon.setAttribute("aria-hidden", "true")
	icon.innerHTML = svg("search")
	const input = part(document, "input", "input") as HTMLInputElement
	input.type = "search"
	input.dataset.hzFocus = ""
	input.setAttribute("aria-label", "Search")
	// The `/` key cap, shown while the field is empty (`pk0-search-hint`).
	const shortcut = part(document, "kbd", "shortcut")
	shortcut.setAttribute("aria-hidden", "true")
	shortcut.hidden = true
	node.append(icon, input, shortcut)
	const syncShortcut = () => {
		shortcut.hidden = shortcut.textContent === "" || input.value !== ""
	}
	input.addEventListener("input", syncShortcut)
	const events = () => primitive.events
	const text = revisioned(input, (change) => fire(events(), "change", { ...change }))
	input.addEventListener("keydown", (event) => {
		if (event.isComposing) return
		if (event.key === "Enter") {
			event.preventDefault()
			fire(events(), "submit", { ...text.current() })
		} else if (event.key === "Escape" && input.value !== "") {
			// One path for every browser: clear as an edit, so the revision pair sees it.
			event.preventDefault()
			input.value = ""
			input.dispatchEvent(new Event("input", { bubbles: true }))
		}
	})

	const primitive: Primitive = {
		tag,
		outer: node,
		content: node,
		set: (name, value) => {
			if (name === "placeholder") {
				input.placeholder = typeof value === "string" ? value : ""
				input.setAttribute("aria-label", typeof value === "string" ? value : "Search")
			} else if (name === "value") {
				text.receive(value)
				syncShortcut()
			} else if (name === "width") option(node, name, value)
			else if (name === "shortcut") {
				shortcut.textContent = typeof value === "string" ? value : ""
				if (typeof value === "string") input.setAttribute("aria-keyshortcuts", value)
				else input.removeAttribute("aria-keyshortcuts")
				syncShortcut()
			}
		},
		events: undefined,
	}
	return primitive
})
