/**
 * `hz:emojiPicker` on the web (lane A3, G3): today's frimousse picker as a non-modal panel the view
 * opens (`open`), anchored at what had focus when it opened. It draws the screen's `categories` (the
 * built-in set when none), custom emojis as images; typing narrows by name and tags, best first;
 * arrow keys move through nine columns (a roving tab stop) and the footer names the emoji under the
 * pointer or focus; Enter or a press picks (`select`); Escape or a press outside asks to close
 * (`dismiss`). `loading` shows a spinner, `error` the reason with "Try again" (`retry`).
 */
import type { Rect } from "../../../vocabulary/Hazel.ts"
import { focusElement } from "../../focus/focusable.ts"
import { measureNode } from "../../focus/measure.ts"
import { trackPlacement } from "../../focus/position.ts"
import { makePopoverPanel } from "../../focus/surface.ts"
import { glyph } from "../../icons.ts"
import { definePrimitive, flag, part, type Plain, type Primitive } from "../define.ts"
import { primitive as buttonRenderer } from "../controls/button.ts"
import { builtInCategories, type EmojiCategory, type PickerEmoji, searchEmoji } from "./emoji-data.ts"
import { controlledOverlay, fire } from "./overlay.ts"
import { spinner } from "./spinner.ts"

/** Today's `COLUMNS` (frimousse's `columns={9}`). */
const COLUMNS = 9

// Renderer-owned (C3 `rendererFeatures`): the panel's height (a phone caps it at 60% of the view),
// the nine-column grid, sticky titles, the footer's top edge, the field's hover and focus-within.
const css = `
[data-hz=emojiPicker] > [data-hz-part=panel] { height: var(--hz-space-105); max-height: 60dvh; overflow: hidden; }
@media (width >= 48rem) { [data-hz=emojiPicker] > [data-hz-part=panel] { max-height: none; } }
[data-hz=emojiPicker] [data-hz-part=grid] { position: relative; overscroll-behavior: contain; scrollbar-gutter: stable; outline: none; }
[data-hz=emojiPicker] [data-hz-part=categoryTitle] { position: sticky; top: 0; z-index: 1; user-select: none; }
[data-hz=emojiPicker] [data-hz-part=emojis] { display: grid; grid-template-columns: repeat(${COLUMNS}, max-content); }
[data-hz=emojiPicker] [data-hz-part=emoji] { cursor: pointer; outline: none; }
[data-hz=emojiPicker] [data-hz-part=emojiImage], [data-hz=emojiPicker] [data-hz-part=footerImage] { object-fit: contain; }
[data-hz=emojiPicker] [data-hz-part=searchBox]:is(:hover, :focus-within) { background-color: var(--hz-color-field-hover); }
[data-hz=emojiPicker] [data-hz-part=searchBox]:focus-within { color: var(--hz-color-fg); }
[data-hz=emojiPicker] [data-hz-part=searchIcon] > svg { display: block; width: 100%; height: 100%; }
[data-hz=emojiPicker] [data-hz-part=search]:is(:focus, :focus-visible) { outline: none; }
[data-hz=emojiPicker] [data-hz-part=search]::placeholder { color: var(--hz-color-muted-fg); opacity: 1; }
[data-hz=emojiPicker] [data-hz-part=search]::-webkit-search-cancel-button { display: none; }
[data-hz=emojiPicker] [data-hz-part=footer] { border-top: 1px solid var(--hz-color-border); }
[data-hz=emojiPicker] [data-hz-part=status] [data-hz-spinner] { width: var(--hz-space-4); height: var(--hz-space-4); }
`

const installed = new WeakSet<Document>()
const ensureCss = (document: Document) => {
	if (installed.has(document)) return
	installed.add(document)
	const style = document.createElement("style")
	style.dataset.hzRenderer = "emojiPicker"
	style.textContent = css
	document.head.append(style)
}

/** Where an anchored picker opens: at `opener` when it has a box, else at `fallback`. */
export const openerRect = (opener: Element | null, fallback: Element): Rect => {
	if (opener !== null && opener.isConnected) {
		const rect = measureNode(opener)
		if (rect.width > 0 || rect.height > 0) return rect
	}
	return measureNode(fallback)
}

/** Arrow-key movement over a flat list laid out `columns` wide. */
export const gridStep = (key: string, at: number, count: number, columns: number): number | undefined => {
	const next =
		key === "ArrowRight"
			? at + 1
			: key === "ArrowLeft"
				? at - 1
				: key === "ArrowDown"
					? at + columns
					: key === "ArrowUp"
						? at - columns
						: key === "Home"
							? 0
							: key === "End"
								? count - 1
								: undefined
	return next === undefined ? undefined : Math.max(0, Math.min(count - 1, next))
}

// SAFETY: the host only passes `categories` that decoded as `Content.EmojiCategory` arrays (`spec.ts`).
const categoriesOf = (value: Plain): ReadonlyArray<EmojiCategory> | undefined =>
	Array.isArray(value) ? (value as never) : undefined

const image = (document: Document, name: string, src: string) => {
	const node = part(document, "img", name) as HTMLImageElement
	node.src = src
	node.alt = ""
	node.loading = "lazy"
	return node
}

export const primitive = definePrimitive("emojiPicker", ({ document, tag, outer }) => {
	ensureCss(document)
	const node = outer("span")
	const panel = makePopoverPanel(part(document, "div", "panel"))
	panel.setAttribute("role", "dialog")
	panel.setAttribute("aria-label", "Emoji picker")
	const header = part(document, "div", "header")
	const searchBox = part(document, "label", "searchBox")
	const searchIcon = part(document, "span", "searchIcon")
	searchIcon.setAttribute("aria-hidden", "true")
	glyph(searchIcon, "search")
	const search = part(document, "input", "search") as HTMLInputElement
	search.type = "search"
	search.placeholder = "Search emoji…"
	search.setAttribute("aria-label", "Search emoji")
	search.autocomplete = "off"
	search.spellcheck = false
	search.enterKeyHint = "done"
	searchBox.append(searchIcon, search)
	header.append(searchBox)
	const grid = part(document, "div", "grid")
	grid.dataset.scroll = ""
	const footer = part(document, "div", "footer")
	panel.append(header, grid, footer)
	node.append(panel)
	// "Try again" under the reason (`button` `outline` `small`, today's).
	const retry = buttonRenderer.create({
		document,
		tag: "hz:button",
		outer: (tagName) => {
			const button = document.createElement(tagName)
			button.dataset.hz = "button"
			return button
		},
		self: (button, set) => ({ tag: "hz:button", outer: button, content: button, set, events: undefined }),
	})
	for (const [name, value] of [
		["label", "Try again"],
		["variant", "outline"],
		["size", "small"],
	] as const)
		retry.set(name, value)
	retry.outer.addEventListener("click", () => fire(primitive, "retry"))

	let opener: Element | null = null
	let categories: ReadonlyArray<EmojiCategory> | undefined
	let loading = false
	let error: string | undefined
	let hovered: PickerEmoji | undefined

	const buttons = () => [...grid.querySelectorAll<HTMLButtonElement>("[data-hz-part=emoji]")]
	const entries = new WeakMap<Element, PickerEmoji>()
	const drawFooter = () => {
		if (hovered === undefined) {
			const hint = part(document, "span", "footerHint")
			hint.textContent = "Pick an emoji"
			return footer.replaceChildren(hint)
		}
		const face = part(document, "div", "footerEmoji")
		if (hovered.image !== undefined) face.append(image(document, "footerImage", hovered.image))
		else face.textContent = hovered.emoji
		const label = part(document, "span", "footerLabel")
		label.textContent = hovered.name
		footer.replaceChildren(face, label)
	}
	const activate = (target: HTMLButtonElement | undefined) => {
		for (const button of buttons()) flag(button, "selected", button === target)
		hovered = target === undefined ? undefined : entries.get(target)
		drawFooter()
	}
	const rove = (target: HTMLButtonElement | undefined) => {
		for (const button of buttons()) button.tabIndex = button === target ? 0 : -1
		activate(target)
		focusElement(target)
	}
	const pick = (each: PickerEmoji) => fire(primitive, "select", { emoji: each.emoji })

	const status = (...children: Array<Node>) => {
		const line = part(document, "div", "status")
		line.append(...children)
		return line
	}
	const render = () => {
		hovered = undefined
		drawFooter()
		if (error !== undefined) {
			const title = part(document, "span", "statusTitle")
			title.textContent = error
			const line = status(title, retry.outer)
			line.setAttribute("role", "alert")
			return grid.replaceChildren(line)
		}
		if (loading) return grid.replaceChildren(status(spinner(document, "spinner")))
		const shown = searchEmoji(categories ?? builtInCategories, search.value)
		if (shown.length === 0) return grid.replaceChildren(status(document.createTextNode("No emoji found")))
		const groups = shown.map((category) => {
			const group = part(document, "div", "category")
			group.setAttribute("role", "group")
			group.setAttribute("aria-label", category.label)
			const title = part(document, "p", "categoryTitle")
			title.textContent = category.label
			title.setAttribute("aria-hidden", "true")
			const row = part(document, "div", "emojis")
			for (const each of category.emojis) {
				const button = part(document, "button", "emoji") as HTMLButtonElement
				button.type = "button"
				button.tabIndex = -1
				if (each.image !== undefined) button.append(image(document, "emojiImage", each.image))
				else button.textContent = each.emoji
				button.setAttribute("aria-label", each.name)
				entries.set(button, each)
				button.addEventListener("click", () => pick(each))
				row.append(button)
			}
			group.append(title, row)
			return group
		})
		grid.replaceChildren(...groups)
		const first = buttons()[0]
		if (first !== undefined) first.tabIndex = 0
	}
	render()
	search.addEventListener("input", render)
	// The footer follows the pointer (frimousse's active emoji); leaving the grid clears it.
	grid.addEventListener("pointerover", (event) => {
		const target = event.target instanceof Element ? event.target.closest("[data-hz-part=emoji]") : null
		if (target instanceof HTMLButtonElement) activate(target)
	})
	grid.addEventListener("pointerleave", () => activate(undefined))
	search.addEventListener("keydown", (event) => {
		if (event.key === "ArrowDown") {
			event.preventDefault()
			rove(buttons()[0])
		} else if (event.key === "Enter") {
			event.preventDefault()
			const first = buttons()[0]
			const each = first === undefined ? undefined : entries.get(first)
			if (each !== undefined) pick(each)
		}
	})
	grid.addEventListener("keydown", (event) => {
		const all = buttons()
		const at = all.findIndex((button) => button === document.activeElement)
		if (at < 0) return
		if (event.key === "ArrowUp" && at < COLUMNS) {
			event.preventDefault()
			activate(undefined)
			focusElement(search)
			return
		}
		const next = gridStep(event.key, at, all.length, COLUMNS)
		if (next === undefined) return
		event.preventDefault()
		rove(all[next])
	})

	const overlay = controlledOverlay({
		outer: node,
		panel,
		modal: false,
		// A modal popover today (`picker-popover/popover.ts`): the page scrolls no further and goes inert.
		isolate: true,
		layer: () => ({ dismissOnOutside: true, returnFocus: opener, initialFocus: () => search }),
		place: () =>
			trackPlacement(panel, () => openerRect(opener, node), { side: "top", align: "start", gap: 8 }),
		beforeShow: () => {
			search.value = ""
			render()
		},
		onDismiss: () => fire(primitive, "dismiss"),
	})

	const primitive: Primitive = {
		tag,
		outer: node,
		content: node,
		set: (name, value) => {
			if (name === "open") {
				if (value === true && !overlay.isShown()) opener = document.activeElement
				overlay.setOpen(value === true)
				return
			}
			if (name === "categories") categories = categoriesOf(value)
			else if (name === "loading") loading = value === true
			else if (name === "error") error = typeof value === "string" ? value : undefined
			else return
			render()
		},
		events: undefined,
	}
	return primitive
})
