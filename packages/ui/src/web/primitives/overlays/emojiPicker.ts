/**
 * `hz:emojiPicker` on the web (lane A3): a non-modal picker the view opens (`open`), anchored at what
 * had focus when it opened (the composer's or the row's emoji button). Typing in its search narrows
 * the grid; arrow keys move through the grid (a roving tab stop); Enter or a press picks (`select`
 * with the emoji); Escape or a press outside asks to close (`dismiss`).
 */
import type { Rect } from "../../../vocabulary/Hazel.ts"
import { focusElement } from "../../focus/focusable.ts"
import { measureNode } from "../../focus/measure.ts"
import { trackPlacement } from "../../focus/position.ts"
import { makePopoverPanel } from "../../focus/surface.ts"
import { definePrimitive, part, type Primitive } from "../define.ts"
import { searchEmoji } from "./emoji-data.ts"
import { controlledOverlay, fire } from "./overlay.ts"

const COLUMNS = 8

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

export const primitive = definePrimitive("emojiPicker", ({ document, tag, outer }) => {
	const node = outer("span")
	const panel = makePopoverPanel(part(document, "div", "panel"))
	panel.setAttribute("role", "dialog")
	panel.setAttribute("aria-label", "Emoji picker")
	const search = part(document, "input", "search") as HTMLInputElement
	search.type = "search"
	search.placeholder = "Search emoji"
	search.setAttribute("aria-label", "Search emoji")
	search.autocomplete = "off"
	const grid = part(document, "div", "grid")
	grid.dataset.scroll = ""
	const empty = part(document, "p", "empty")
	empty.textContent = "No emoji found"
	empty.hidden = true
	panel.append(search, grid, empty)
	node.append(panel)
	let opener: Element | null = null

	const buttons = () => [...grid.querySelectorAll<HTMLButtonElement>("[data-hz-part=emoji]")]
	const rove = (target: HTMLButtonElement | undefined) => {
		for (const button of buttons()) button.tabIndex = button === target ? 0 : -1
		focusElement(target)
	}
	const pick = (emoji: string) => fire(primitive, "select", { emoji })

	const render = () => {
		const categories = searchEmoji(search.value)
		const groups = categories.map((category) => {
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
				button.textContent = each.emoji
				button.setAttribute("aria-label", each.name)
				button.title = each.name
				button.addEventListener("click", () => pick(each.emoji))
				row.append(button)
			}
			group.append(title, row)
			return group
		})
		grid.replaceChildren(...groups)
		empty.hidden = groups.length > 0
		const first = buttons()[0]
		if (first !== undefined) first.tabIndex = 0
	}
	render()
	search.addEventListener("input", render)
	search.addEventListener("keydown", (event) => {
		if (event.key === "ArrowDown") {
			event.preventDefault()
			rove(buttons()[0])
		} else if (event.key === "Enter") {
			event.preventDefault()
			const first = buttons()[0]
			if (first !== undefined) pick(first.textContent ?? "")
		}
	})
	grid.addEventListener("keydown", (event) => {
		const all = buttons()
		const at = all.findIndex((button) => button === document.activeElement)
		if (at < 0) return
		if (event.key === "ArrowUp" && at < COLUMNS) {
			event.preventDefault()
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
			if (name !== "open") return
			if (value === true && !overlay.isShown()) opener = document.activeElement
			overlay.setOpen(value === true)
		},
		events: undefined,
	}
	return primitive
})
