/**
 * `hz:button`: a native `button` (Enter and Space press it) holding an icon part and a label part, the
 * structure `tokens.css` and the parity gallery (`gallery/hazel.ts`) style. `iconOnly` drops the label
 * part and names the button with `aria-label`; `loading` keeps it focusable but swallows presses.
 * `selected` is a toggle's on state (`aria-pressed`); a `chip` is always a toggle, so it says `false` too.
 */
// Owned by lane A2.
import { svg } from "../../icons.ts"
import { definePrimitive, flag, option, part } from "../define.ts"
import { ensureStyles } from "./styles.ts"

export const primitive = definePrimitive("button", ({ document, outer, self }) => {
	ensureStyles(document)
	const node = outer("button") as HTMLButtonElement
	node.setAttribute("type", "button")
	const label = part(document, "span", "label")
	let icon: Element | undefined
	let text = ""
	let iconName: string | undefined
	let iconOnly = false
	let loading = false
	let chip = false
	let selected = false

	const iconOf = (name: string) => {
		const holder = document.createElement("span")
		holder.innerHTML = svg(name)
		const found = holder.firstElementChild ?? document.createElement("span")
		found.setAttribute("data-hz-part", "icon")
		found.setAttribute("aria-hidden", "true")
		return found
	}
	const draw = () => {
		const wanted = iconName === undefined ? undefined : iconOf(iconName)
		icon?.remove()
		icon = wanted
		node.replaceChildren(
			...(icon === undefined ? [] : [icon]),
			...(iconOnly || text === "" ? [] : [label]),
		)
		if (iconOnly && text !== "") node.setAttribute("aria-label", text)
		else node.removeAttribute("aria-label")
	}
	const pressed = () => {
		if (chip || selected) node.setAttribute("aria-pressed", selected ? "true" : "false")
		else node.removeAttribute("aria-pressed")
	}
	// A loading button stays in the tab order (React Aria's pending) but presses do nothing.
	node.addEventListener("click", (event) => {
		if (!loading) return
		event.preventDefault()
		event.stopImmediatePropagation()
	})

	return self(node, (name, value) => {
		if (name === "label") {
			text = typeof value === "string" ? value : ""
			label.textContent = text
			draw()
		} else if (name === "icon") {
			iconName = typeof value === "string" ? value : undefined
			draw()
		} else if (name === "iconOnly") {
			iconOnly = value === true
			flag(node, "icon-only", value)
			draw()
		} else if (name === "variant" || name === "size") {
			option(node, name, value)
			if (name === "variant") {
				chip = value === "chip"
				pressed()
			}
		} else if (name === "selected") {
			selected = value === true
			flag(node, "selected", value)
			pressed()
		} else if (name === "circle") flag(node, "circle", value)
		else if (name === "disabled") {
			flag(node, "disabled", value)
			node.disabled = value === true
		} else if (name === "loading") {
			loading = value === true
			flag(node, "loading", value)
			if (loading) {
				node.setAttribute("aria-disabled", "true")
				node.setAttribute("aria-busy", "true")
			} else {
				node.removeAttribute("aria-disabled")
				node.removeAttribute("aria-busy")
			}
		}
	})
})
