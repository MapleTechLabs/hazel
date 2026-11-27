/**
 * `hz:button`: a native `button` (Enter and Space press it) holding an icon part and a label part, the
 * structure `tokens.css` and the parity gallery (`gallery/hazel.ts`) style. `iconOnly` drops the label
 * part and names the button with `aria-label`; `loading` keeps it focusable but swallows presses.
 * `selected` is a toggle's on state (`aria-pressed`); a `chip` is always a toggle, so it says `false` too.
 * `removable` adds a trailing remove mark: a press on it, or Delete or Backspace, raises `remove`.
 * `detail` is a quieter run before the label; `trailingIcon` follows the label.
 */
// Owned by lane A2.
import { svg } from "../../icons.ts"
import { definePrimitive, flag, option, part } from "../define.ts"
import { ensureChoiceStyles } from "./choice-styles.ts"
import { fire } from "./field.ts"
import { ensureStyles } from "./styles.ts"

export const primitive = definePrimitive("button", ({ document, outer, self }) => {
	ensureStyles(document)
	ensureChoiceStyles(document)
	const node = outer("button") as HTMLButtonElement
	node.setAttribute("type", "button")
	const label = part(document, "span", "label")
	const detail = part(document, "span", "detail")
	let detailText = ""
	let trailing: Element | undefined
	let trailingName: string | undefined
	// A button cannot hold another, so the mark is pointer-only; the keyboard removes with Delete.
	const remove = part(document, "span", "remove")
	remove.setAttribute("aria-hidden", "true")
	remove.innerHTML = svg("close")
	let removable = false
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
		trailing = trailingName === undefined ? undefined : iconOf(trailingName)
		trailing?.setAttribute("data-hz-part", "trailingIcon")
		const named = iconOnly || text === ""
		node.replaceChildren(
			...(icon === undefined ? [] : [icon]),
			...(named || detailText === "" ? [] : [detail]),
			...(named ? [] : [label]),
			...(trailing === undefined ? [] : [trailing]),
			...(removable ? [remove] : []),
		)
		const full = detailText === "" ? text : `${detailText} ${text}`
		if (iconOnly && text !== "") node.setAttribute("aria-label", full)
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

	remove.addEventListener("click", (event) => {
		event.preventDefault()
		event.stopImmediatePropagation()
		if (!loading && !node.disabled) fire(primitive.events, "remove", {})
	})
	node.addEventListener("keydown", (event) => {
		if (!removable || loading || (event.key !== "Delete" && event.key !== "Backspace")) return
		if (fire(primitive.events, "remove", {})) event.preventDefault()
	})

	const primitive = self(node, (name, value) => {
		if (name === "label") {
			text = typeof value === "string" ? value : ""
			label.textContent = text
			draw()
		} else if (name === "icon") {
			iconName = typeof value === "string" ? value : undefined
			draw()
		} else if (name === "detail") {
			detailText = typeof value === "string" ? value : ""
			detail.textContent = detailText
			draw()
		} else if (name === "trailingIcon") {
			trailingName = typeof value === "string" ? value : undefined
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
		} else if (name === "removable") {
			removable = value === true
			flag(node, "removable", value)
			if (removable) node.setAttribute("aria-keyshortcuts", "Delete")
			else node.removeAttribute("aria-keyshortcuts")
			draw()
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
	return primitive
})
