/**
 * The modal panel `hz:dialog` and `hz:sheet` share (lane A3): a native `<dialog>` shown with
 * `showModal()` (the page goes inert, the panel joins the top layer), a header with the title, the
 * content parent, and the layer stack's focus trap and return. Escape and a press on the scrim ask
 * to close (`dismiss`); the panel closes when the view sets `open` false.
 */
import { tabbables } from "../../focus/focusable.ts"
import { definePrimitive, part, type Plain, type Primitive } from "../define.ts"
import { controlledOverlay, fire, nextId, textOf } from "./overlay.ts"

export interface ModalParts {
	readonly node: HTMLElement
	readonly panel: HTMLDialogElement
	readonly header: HTMLElement
	readonly title: HTMLElement
	/** Asks the view to close. */
	readonly dismiss: () => void
}

/** Adds a tag's own parts; returns its own props' setter (true when it took the prop). */
export type ModalSetup = (parts: ModalParts) => (name: string, value: Plain) => boolean

const createModal = (document: Document, tag: string, node: HTMLElement, setup: ModalSetup): Primitive => {
	const panel = part(document, "dialog", "panel") as HTMLDialogElement
	panel.dataset.hzLayer = ""
	panel.setAttribute("aria-modal", "true")
	panel.setAttribute("role", "dialog")
	const header = part(document, "header", "header")
	const title = part(document, "h2", "title")
	title.id = nextId("title")
	header.append(title)
	const content = part(document, "div", "content")
	panel.append(header, content)
	node.append(panel)
	const own = setup({ node, panel, header, title, dismiss: () => fire(primitive, "dismiss") })

	const overlay = controlledOverlay({
		outer: node,
		panel,
		modal: true,
		layer: () => ({
			// The first stop in the content (its actions come first), not the header's close button.
			initialFocus: () => tabbables(content)[0] ?? null,
		}),
		onDismiss: () => fire(primitive, "dismiss"),
	})
	// Escape is the layer stack's; a press on the scrim lands on the dialog outside its box.
	panel.addEventListener("cancel", (event) => event.preventDefault())
	panel.addEventListener("pointerdown", (event) => {
		if (event.target !== panel) return
		const box = panel.getBoundingClientRect()
		const outside =
			event.clientX < box.left ||
			event.clientX > box.right ||
			event.clientY < box.top ||
			event.clientY > box.bottom
		if (outside) fire(primitive, "dismiss")
	})

	const primitive: Primitive = {
		tag,
		outer: node,
		content,
		set: (name, value) => {
			if (own(name, value)) return
			if (name === "open") overlay.setOpen(value === true)
			else if (name === "title") {
				title.textContent = textOf(value)
				if (title.textContent === "") panel.removeAttribute("aria-labelledby")
				else panel.setAttribute("aria-labelledby", title.id)
			}
		},
		events: undefined,
	}
	return primitive
}

/** A `definePrimitive` for a modal tag. */
export const modalPrimitive = (key: "dialog" | "sheet", setup: ModalSetup) =>
	definePrimitive(key, ({ document, tag, outer }) => createModal(document, tag, outer("div"), setup))
