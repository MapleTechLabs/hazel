/**
 * `hz:menu` on the web (lane A3): a menu button. The `trigger` slot is the button (a plain one with
 * `label` and a chevron when the view gives none); pressing it, or ArrowDown/ArrowUp on it, opens
 * the entries below it (`menu-list.ts`). The menu holds its own open state; a pick raises `select`.
 * In a gallery frame it draws open in place, so the case shows its entries.
 */
import { measureNode } from "../../focus/measure.ts"
import { isSpecimen, whenConnected } from "../../focus/surface.ts"
import { svg } from "../../icons.ts"
import { definePrimitive, part, type Primitive } from "../define.ts"
import { asGroups, createMenuList } from "./menu-list.ts"
import { fire, textOf } from "./overlay.ts"

export const primitive = definePrimitive("menu", ({ document, tag, outer }) => {
	const node = outer("div")
	const content = part(document, "span", "content")
	const button = part(document, "button", "button")
	button.setAttribute("type", "button")
	const buttonLabel = part(document, "span", "buttonLabel")
	const chevron = part(document, "span", "buttonIcon")
	chevron.setAttribute("aria-hidden", "true")
	chevron.innerHTML = svg("chevron-down")
	button.append(buttonLabel, chevron)
	node.append(content, button)

	const list = createMenuList(document, node, (id) => fire(primitive, "select", { id }))
	let label = ""

	/** The slot's own control, else the slot; the plain button when there is no slot. */
	const trigger = (): HTMLElement => {
		const slot = content.querySelector<HTMLElement>(":scope > [data-hz-slot=trigger]")
		if (slot === null) return button
		return slot.querySelector<HTMLElement>("button, a[href], [tabindex], [role=button]") ?? slot
	}
	const sync = () => {
		const hasSlot = content.querySelector(":scope > [data-hz-slot=trigger]") !== null
		button.hidden = hasSlot
		const control = trigger()
		control.setAttribute("aria-haspopup", "menu")
		control.setAttribute("aria-expanded", String(list.isOpen()))
		control.setAttribute("aria-controls", list.panel.id)
		if (label !== "" && control !== button && !control.hasAttribute("aria-label"))
			control.setAttribute("aria-label", label)
	}
	if (typeof MutationObserver === "function")
		new MutationObserver(sync).observe(content, { childList: true })

	const open = (focus: "first" | "last") => {
		sync()
		list.open({
			anchor: () => measureNode(trigger()),
			placement: { side: "bottom", align: "start", gap: 4 },
			focus,
			inside: () => [content, button],
			onClose: sync,
		})
		sync()
	}
	const toggle = () => (list.isOpen() ? list.close(true) : open("first"))
	content.addEventListener("click", toggle)
	button.addEventListener("click", toggle)
	const onKey = (event: KeyboardEvent) => {
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
		event.preventDefault()
		open(event.key === "ArrowDown" ? "first" : "last")
	}
	content.addEventListener("keydown", onKey)
	button.addEventListener("keydown", onKey)
	// A gallery case shows the menu open.
	whenConnected(node)(() => {
		sync()
		if (isSpecimen(node)) open("first")
	})

	const primitive: Primitive = {
		tag,
		outer: node,
		content,
		set: (name, value) => {
			if (name === "label") {
				label = textOf(value)
				buttonLabel.textContent = label
				list.setLabel(label)
				sync()
			} else if (name === "entries") list.setEntries(asGroups(value))
		},
		events: undefined,
	}
	return primitive
})
