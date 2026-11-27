/**
 * `hz:commandPalette` on the web (lane A3), today's `ui/command-menu-view.ts`: a modal `<dialog>` with a
 * query field over the screen's filtered `groups`. Arrows move a wrapping virtual highlight, Enter picks
 * it, Escape clears the query and then asks to close. With a `title` it is a form page over its children.
 */
import type { PaletteGroups, PaletteItem } from "../../../vocabulary/content.ts"
import { tabbables } from "../../focus/focusable.ts"
import { svg } from "../../icons.ts"
import { revisioned } from "../controls/field.ts"
import { definePrimitive, flag, part, type Plain, type Primitive } from "../define.ts"
import { controlledOverlay, fire, nextId, textOf } from "./overlay.ts"
import { spinner } from "./spinner.ts"

const P = "[data-hz=commandPalette]"
// Placement, resets and the wide-screen key hints (C3 `rendererFeatures`); looks are the recipe's.
const css = `
${P} > [data-hz-part="panel"] {
	inset: auto 0 0 0;
	width: 100%;
	max-height: 80dvh;
	overflow: hidden;
	border-bottom-left-radius: 0;
	border-bottom-right-radius: 0;
}
${P} > [data-hz-part="panel"][data-open] { display: flex; }
@media (width >= 40rem) {
	${P} > [data-hz-part="panel"] {
		inset: 10% 0 auto 0;
		margin: 0 auto;
		width: min(100% - 2 * var(--hz-space-4), 32rem);
		border-bottom-left-radius: var(--hz-radius-xl);
		border-bottom-right-radius: var(--hz-radius-xl);
	}
	${P} [data-hz-part="results"] { max-height: 27.5rem; }
}
${P} :is([data-hz-part="results"], [data-hz-part="content"]) { flex: 1; min-height: 0; overflow-y: auto; }
${P} :is([data-hz-part="field"], [data-hz-part="header"], [data-hz-part="results"], [data-hz-part="content"], [data-hz-part="back"], [data-hz-part="empty"])[hidden] { display: none; }
${P} [data-hz-part="input"] {
	appearance: none;
	min-width: 0;
	border: 0;
	margin: 0;
	background: transparent;
	font-family: inherit;
	outline: none;
}
${P} [data-hz-part="input"]::placeholder { color: var(--hz-color-muted-fg); }
${P} [data-hz-part="input"]::-webkit-search-cancel-button { display: none; }
${P} :is([data-hz-part="escape"], [data-hz-part="back"]) {
	appearance: none;
	margin: 0;
	background: transparent;
	font-family: inherit;
	cursor: default;
}
${P} [data-hz-part="back"] { border: 0; }
${P} :is([data-hz-part="escape"], [data-hz-part="back"]):hover { background: var(--hz-color-muted); color: var(--hz-color-fg); }
${P} [data-hz-part="back"]:focus-visible { outline: 2px solid var(--hz-color-ring); outline-offset: 1px; }
${P} :is([data-hz-part="fieldIcon"], [data-hz-part="itemIcon"]) > svg { display: block; width: 100%; height: 100%; }
${P} [data-hz-part="back"] > svg { display: block; width: 1rem; height: 1rem; }
${P} [data-hz-part="itemFace"] {
	display: grid;
	place-items: center;
	overflow: hidden;
	background: var(--hz-color-secondary);
	color: var(--hz-color-secondary-fg);
}
${P} [data-hz-part="itemFace"] > img { width: 100%; height: 100%; object-fit: cover; }
${P} [data-hz-part="itemDescription"] { margin-left: auto; }
${P} [data-hz-part="itemShortcut"] { margin-left: auto; padding-left: var(--hz-space-2); font-family: inherit; letter-spacing: 0.025em; }
${P} [data-hz-part="item"][data-highlighted] [data-hz-part="itemShortcut"] { color: var(--hz-color-fg-2); }
@media (width < 64rem) { ${P} :is([data-hz-part="escape"], [data-hz-part="itemShortcut"]) { display: none; } }
${P}[data-specimen] {
	display: grid;
	place-items: start center;
	padding: var(--hz-space-6);
	background: var(--hz-color-scrim);
}
${P}[data-specimen] > [data-hz-part="panel"][data-open] {
	width: min(100%, 32rem);
	border-radius: var(--hz-radius-xl);
}
`

const installed = new WeakSet<Document>()
const ensureStyles = (document: Document) => {
	if (installed.has(document)) return
	installed.add(document)
	const style = document.createElement("style")
	style.dataset.hzCommandPalette = ""
	style.textContent = css
	;(document.head ?? document.documentElement).append(style)
}

const asGroups = (value: Plain): PaletteGroups => (Array.isArray(value) ? (value as PaletteGroups) : [])

const isMac = (document: Document) => /Mac|iPhone|iPad/.test(document.defaultView?.navigator.platform ?? "")

/** Each modifier word as a Mac key cap and as its name elsewhere. */
const MODIFIERS = {
	mod: ["⌘", "Ctrl"],
	cmd: ["⌘", "Ctrl"],
	ctrl: ["⌃", "Ctrl"],
	alt: ["⌥", "Alt"],
	shift: ["⇧", "Shift"],
} as const
const isModifier = (key: string): key is keyof typeof MODIFIERS => Object.hasOwn(MODIFIERS, key)

/** `mod+shift+n` as today's label (`⌘⇧N` on a Mac, `Ctrl+Shift+N` elsewhere); other text as given. */
export const shortcutLabel = (text: string, mac: boolean): string => {
	if (!/^[a-z0-9]+(\+[a-z0-9]+)+$/i.test(text)) return text
	return text
		.split("+")
		.map((key) => {
			const word = key.toLowerCase()
			return isModifier(word) ? MODIFIERS[word][mac ? 0 : 1] : key.toUpperCase()
		})
		.join(mac ? "" : "+")
}

const iconPart = (document: Document, name: string, partName: string) => {
	const node = part(document, "span", partName)
	node.setAttribute("aria-hidden", "true")
	node.innerHTML = svg(name)
	return node
}

const escapeButton = (document: Document) => {
	const button = part(document, "button", "escape")
	button.setAttribute("type", "button")
	button.setAttribute("tabindex", "-1")
	button.setAttribute("aria-label", "Close")
	button.textContent = "Esc"
	return button
}

const DEFAULT_EMPTY = "No results found."

export const primitive = definePrimitive("commandPalette", ({ document, tag, outer }) => {
	ensureStyles(document)
	const node = outer("div")
	const panel = part(document, "dialog", "panel") as HTMLDialogElement
	panel.dataset.hzLayer = ""
	panel.setAttribute("aria-modal", "true")
	panel.setAttribute("role", "dialog")
	panel.setAttribute("aria-label", "Command Menu")
	const base = nextId("palette")

	// The list page: the field, then the results.
	const field = part(document, "div", "field")
	const fieldIcon = iconPart(document, "search", "fieldIcon")
	const busy = spinner(document, "fieldIcon")
	busy.hidden = true
	const input = part(document, "input", "input") as HTMLInputElement
	input.type = "search"
	input.dataset.hzFocus = ""
	input.autocomplete = "off"
	input.spellcheck = false
	input.enterKeyHint = "go"
	input.setAttribute("aria-label", "Quick search")
	input.setAttribute("aria-autocomplete", "list")
	input.setAttribute("aria-controls", `${base}-list`)
	input.setAttribute("autocorrect", "off")
	const escape = escapeButton(document)
	field.append(fieldIcon, busy, input, escape)
	const results = part(document, "div", "results")
	results.id = `${base}-list`
	results.setAttribute("role", "menu")
	results.setAttribute("aria-label", "Suggestions")
	const empty = part(document, "div", "empty")

	// The form page: a header over the children.
	const header = part(document, "div", "header")
	const back = part(document, "button", "back")
	back.setAttribute("type", "button")
	back.setAttribute("aria-label", "Back")
	back.innerHTML = svg("chevron-left")
	const title = part(document, "h2", "title")
	title.id = `${base}-title`
	const headerEscape = escapeButton(document)
	header.append(back, title, headerEscape)
	const content = part(document, "div", "content")
	panel.append(field, header, results, content)
	node.append(panel)

	let groups: PaletteGroups = []
	let items: ReadonlyArray<{ readonly item: PaletteItem; readonly element: HTMLElement }> = []
	let highlighted: string | undefined
	let emptyText = DEFAULT_EMPTY
	let loading = false
	let formPage = false
	// Set by typing: the next results highlight their first item, as today's `ChangedSearch` does.
	let edited = false

	const text = revisioned(input, (change) => fire(primitive, "change", { ...change }))

	const highlight = (id: string | undefined, reveal: boolean) => {
		const current = items.find((entry) => entry.item.id === id)
		highlighted = current?.item.id
		for (const entry of items) flag(entry.element, "highlighted", entry === current)
		if (current === undefined) input.removeAttribute("aria-activedescendant")
		else {
			input.setAttribute("aria-activedescendant", current.element.id)
			if (reveal && typeof current.element.scrollIntoView === "function")
				current.element.scrollIntoView({ block: "nearest" })
		}
	}

	const itemNode = (item: PaletteItem, index: number) => {
		const element = part(document, "div", "item")
		element.id = `${base}-item-${index}`
		element.setAttribute("role", "menuitem")
		if (item.face !== undefined) {
			const face = part(document, "span", "itemFace")
			face.setAttribute("aria-hidden", "true")
			if (item.face.src === undefined) face.textContent = item.face.initials
			else {
				const image = document.createElement("img")
				image.src = item.face.src
				image.alt = ""
				face.append(image)
			}
			element.append(face)
		} else if (item.icon !== undefined) element.append(iconPart(document, item.icon, "itemIcon"))
		const label = part(document, "span", "itemLabel")
		label.id = `${element.id}-label`
		label.textContent = item.label
		element.setAttribute("aria-labelledby", label.id)
		element.append(label)
		if (item.description !== undefined) {
			const description = part(document, "span", "itemDescription")
			description.id = `${element.id}-description`
			description.textContent = item.description
			element.setAttribute("aria-describedby", description.id)
			element.append(description)
		}
		if (item.shortcut !== undefined) {
			const shortcut = part(document, "kbd", "itemShortcut")
			shortcut.dir = "ltr"
			shortcut.setAttribute("aria-hidden", "true")
			shortcut.textContent = shortcutLabel(item.shortcut, isMac(document))
			element.setAttribute("aria-keyshortcuts", item.shortcut)
			element.append(shortcut)
		}
		element.addEventListener("pointermove", () => {
			if (highlighted !== item.id) highlight(item.id, false)
		})
		// The field keeps focus (virtual focus), so a press does not blur it.
		element.addEventListener("pointerdown", (event) => event.preventDefault())
		element.addEventListener("click", () => fire(primitive, "select", { id: item.id }))
		return element
	}

	const showEmpty = () => {
		empty.textContent = emptyText
		empty.hidden = items.length > 0 || loading
	}

	const draw = () => {
		const previous = highlighted
		const drawn: Array<{ readonly item: PaletteItem; readonly element: HTMLElement }> = []
		const sections = groups
			.filter((group) => group.items.length > 0)
			.map((group, at) => {
				const section = part(document, "section", "group")
				section.setAttribute("role", "group")
				if (group.title !== undefined) {
					const heading = part(document, "header", "groupTitle")
					heading.id = `${base}-group-${at}`
					heading.setAttribute("role", "presentation")
					heading.textContent = group.title
					section.setAttribute("aria-labelledby", heading.id)
					section.append(heading)
				}
				for (const item of group.items) {
					const element = itemNode(item, drawn.length)
					drawn.push({ item, element })
					section.append(element)
				}
				return section
			})
		items = drawn
		flag(results, "empty", items.length === 0)
		results.replaceChildren(...sections, empty)
		showEmpty()
		// After an edit the first result; otherwise the same item while it is still there.
		if (edited) highlight(input.value === "" ? undefined : items[0]?.item.id, true)
		else highlight(previous, false)
		edited = false
	}

	const step = (direction: 1 | -1) => {
		if (items.length === 0) return
		const at = items.findIndex((entry) => entry.item.id === highlighted)
		const next =
			at < 0 ? (direction === 1 ? 0 : items.length - 1) : (at + direction + items.length) % items.length
		highlight(items[next]?.item.id, true)
	}

	input.addEventListener("input", () => {
		edited = true
		highlight(input.value === "" ? undefined : items[0]?.item.id, true)
	})
	input.addEventListener("keydown", (event) => {
		if (event.isComposing) return
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault()
			step(event.key === "ArrowDown" ? 1 : -1)
		} else if (event.key === "Enter") {
			event.preventDefault()
			if (highlighted !== undefined) fire(primitive, "select", { id: highlighted })
		} else if (event.key === "Escape" && input.value !== "") {
			// A query clears first (an edit, so the revision pair sees it); the next Escape closes.
			event.preventDefault()
			input.value = ""
			input.dispatchEvent(new Event("input", { bubbles: true }))
		}
	})
	escape.addEventListener("click", () => fire(primitive, "dismiss"))
	headerEscape.addEventListener("click", () => fire(primitive, "dismiss"))
	back.addEventListener("click", () => fire(primitive, "back"))

	const page = () => {
		field.hidden = formPage
		results.hidden = formPage
		header.hidden = !formPage
		content.hidden = !formPage
		back.hidden = primitive.events?.handlers.back === undefined
		if (formPage) panel.setAttribute("aria-labelledby", title.id)
		else panel.removeAttribute("aria-labelledby")
	}

	const overlay = controlledOverlay({
		outer: node,
		panel,
		modal: true,
		isolate: true,
		layer: () => ({
			initialFocus: () => (formPage ? (tabbables(content)[0] ?? null) : input),
		}),
		onDismiss: () => fire(primitive, "dismiss"),
		beforeShow: page,
	})
	// Escape is the layer stack's (after the field's own clear); a press on the scrim asks to close.
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
			if (name === "open") overlay.setOpen(value === true)
			else if (name === "placeholder") input.placeholder = textOf(value)
			else if (name === "query") text.receive(value)
			else if (name === "groups") {
				groups = asGroups(value)
				draw()
			} else if (name === "loading") {
				loading = value === true
				flag(node, "loading", loading)
				fieldIcon.hidden = loading
				busy.hidden = !loading
				if (loading) results.setAttribute("aria-busy", "true")
				else results.removeAttribute("aria-busy")
				showEmpty()
			} else if (name === "empty") {
				emptyText = textOf(value) === "" ? DEFAULT_EMPTY : textOf(value)
				showEmpty()
			} else if (name === "title") {
				title.textContent = textOf(value)
				formPage = title.textContent !== ""
				page()
			}
		},
		events: undefined,
	}
	page()
	draw()
	return primitive
})
