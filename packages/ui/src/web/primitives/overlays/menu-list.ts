/**
 * The menu `hz:menu` and `hz:contextMenu` open (lane A3): `MenuGroups` as an ARIA menu with groups,
 * separators, check marks and one level of submenus (`menu-submenu`). Arrow keys, Home, End and
 * typeahead move between entries, Enter or Space picks one, ArrowRight opens a submenu and ArrowLeft
 * or Escape closes it. Picking an entry (a submenu's too) reports its id and closes the whole menu.
 */
import type { MenuEntry, MenuGroups, MenuLeaf } from "../../../vocabulary/content.ts"
import type { Rect } from "../../../vocabulary/Hazel.ts"
import { focusElement } from "../../focus/focusable.ts"
import { type Layer, openLayer } from "../../focus/layers.ts"
import { measureNode } from "../../focus/measure.ts"
import { type Placement, applyPlacement, trackPlacement } from "../../focus/position.ts"
import {
	hidePanel,
	installOverlayStyles,
	isSpecimen,
	makePopoverPanel,
	showPanel,
	whenConnected,
} from "../../focus/surface.ts"
import { svg } from "../../icons.ts"
import { flag, part } from "../define.ts"
import { nextId } from "./overlay.ts"

export interface OpenOptions {
	/** The rect the menu opens next to (a trigger, or the pointer as a 0x0 rect). */
	readonly anchor: () => Rect | undefined
	readonly placement: Placement
	/** Which entry takes focus. */
	readonly focus: "first" | "last"
	/** Presses here do not close it (the trigger). */
	readonly inside?: () => ReadonlyArray<Element | null | undefined>
	readonly onClose?: () => void
}

export interface MenuList {
	readonly panel: HTMLElement
	readonly setEntries: (groups: MenuGroups | undefined) => void
	readonly setLabel: (label: string) => void
	readonly open: (options: OpenOptions) => void
	readonly close: (restoreFocus?: boolean) => void
	readonly isOpen: () => boolean
}

const isGroups = (value: unknown): value is MenuGroups => Array.isArray(value)

/** A prop value as `MenuGroups` (the schema already checked it on the way in). */
export const asGroups = (value: unknown): MenuGroups | undefined => (isGroups(value) ? value : undefined)

const icon = (document: Document, name: string, partName: string) => {
	const node = part(document, "span", partName)
	node.setAttribute("aria-hidden", "true")
	node.innerHTML = svg(name)
	return node
}

const itemsOf = (menu: HTMLElement): ReadonlyArray<HTMLElement> =>
	[...menu.querySelectorAll<HTMLElement>("[data-hz-part=item]")].filter(
		(item) => item.closest("[role=menu]") === menu,
	)

/** The move a navigation key makes in a menu. */
const stepFor = (key: string): 1 | -1 | "first" | "last" | undefined =>
	key === "ArrowDown"
		? 1
		: key === "ArrowUp"
			? -1
			: key === "Home"
				? "first"
				: key === "End"
					? "last"
					: undefined

const enabled = (item: HTMLElement) => item.getAttribute("aria-disabled") !== "true"

export const createMenuList = (
	document: Document,
	outer: HTMLElement,
	onSelect: (id: string) => void,
): MenuList => {
	const panel = makePopoverPanel(part(document, "div", "panel"))
	panel.setAttribute("role", "menu")
	panel.id = nextId("menu")
	panel.dataset.scroll = ""
	// The submenu is a second `panel` (one recipe styles both levels), marked `data-submenu`.
	const submenu = makePopoverPanel(part(document, "div", "panel"))
	submenu.dataset.submenu = ""
	submenu.setAttribute("role", "menu")
	submenu.id = nextId("submenu")
	outer.append(panel, submenu)

	let groups: MenuGroups = []
	let layer: Layer | undefined
	let stopPlacing: (() => void) | undefined
	let options: OpenOptions | undefined
	let openParent: HTMLElement | undefined
	let typed = ""
	let typedAt = 0
	const schedule = whenConnected(outer)
	const leaves = new Map<HTMLElement, MenuEntry | MenuLeaf>()

	const highlight = (menu: HTMLElement, item: HTMLElement | undefined) => {
		for (const each of itemsOf(menu)) flag(each, "highlighted", each === item)
		if (item !== undefined) focusElement(item)
	}

	const closeSubmenu = (focusParent: boolean) => {
		const parent = openParent
		if (parent === undefined) return
		openParent = undefined
		parent.setAttribute("aria-expanded", "false")
		hidePanel(submenu)
		submenu.replaceChildren()
		if (focusParent) highlight(panel, parent)
	}

	const openSubmenu = (parent: HTMLElement, entry: MenuEntry, focus: boolean) => {
		if (openParent === parent) {
			if (focus) highlight(submenu, itemsOf(submenu).find(enabled))
			return
		}
		closeSubmenu(false)
		openParent = parent
		parent.setAttribute("aria-expanded", "true")
		submenu.setAttribute("aria-label", entry.label)
		submenu.replaceChildren(groupNode({ entries: entry.entries ?? [] }, true))
		const inPlace = isSpecimen(outer)
		showPanel(submenu, { modal: false, inPlace })
		if (!inPlace) applyPlacement(submenu, measureNode(parent), { side: "right", align: "start", gap: 2 })
		if (focus) highlight(submenu, itemsOf(submenu).find(enabled))
	}

	const pick = (item: HTMLElement) => {
		const entry = leaves.get(item)
		if (entry === undefined || !enabled(item)) return
		if ("entries" in entry && entry.entries !== undefined) {
			openSubmenu(item, entry, true)
			return
		}
		close(true)
		onSelect(entry.id)
	}

	const itemNode = (entry: MenuEntry | MenuLeaf, inSubmenu: boolean) => {
		const item = part(document, "div", "item")
		item.tabIndex = -1
		item.dataset.id = entry.id
		const checkable = entry.checked !== undefined
		item.setAttribute("role", checkable ? "menuitemcheckbox" : "menuitem")
		if (checkable) item.setAttribute("aria-checked", String(entry.checked === true))
		if (entry.disabled === true) item.setAttribute("aria-disabled", "true")
		flag(item, "destructive", entry.destructive)
		if (entry.icon !== undefined) item.append(icon(document, entry.icon, "itemIcon"))
		const label = part(document, "span", "itemLabel")
		label.textContent = entry.label
		item.append(label)
		if (checkable) {
			const check = icon(document, "check", "itemCheck")
			check.hidden = entry.checked !== true
			item.append(check)
		}
		const nested = !inSubmenu && "entries" in entry && entry.entries !== undefined
		if (nested) {
			item.setAttribute("aria-haspopup", "menu")
			item.setAttribute("aria-expanded", "false")
			item.setAttribute("aria-controls", submenu.id)
			item.append(icon(document, "chevron-right", "itemChevron"))
		}
		leaves.set(item, entry)
		item.addEventListener("click", () => pick(item))
		item.addEventListener("pointermove", () => {
			const menu = inSubmenu ? submenu : panel
			if (item.dataset.highlighted === undefined) highlight(menu, item)
			if (!inSubmenu) {
				if (nested && enabled(item)) openSubmenu(item, entry as MenuEntry, false)
				else closeSubmenu(false)
			}
		})
		return item
	}

	const groupNode = (group: MenuGroups[number], inSubmenu: boolean) => {
		const node = part(document, "div", "group")
		node.setAttribute("role", "group")
		if (group.title !== undefined) {
			const title = part(document, "div", "groupTitle")
			title.id = nextId("menu-group")
			title.textContent = group.title
			title.setAttribute("role", "presentation")
			node.setAttribute("aria-labelledby", title.id)
			node.append(title)
		}
		for (const entry of group.entries) node.append(itemNode(entry, inSubmenu))
		return node
	}

	const render = () => {
		leaves.clear()
		const children: Array<HTMLElement> = []
		groups.forEach((group, index) => {
			if (index > 0) {
				const separator = part(document, "div", "separator")
				separator.setAttribute("role", "separator")
				children.push(separator)
			}
			children.push(groupNode(group, false))
		})
		panel.replaceChildren(...children)
	}

	const move = (menu: HTMLElement, current: HTMLElement | undefined, step: 1 | -1 | "first" | "last") => {
		const items = itemsOf(menu).filter(enabled)
		if (items.length === 0) return
		const at = current === undefined ? -1 : items.indexOf(current)
		const next =
			step === "first"
				? items[0]
				: step === "last"
					? items.at(-1)
					: (items[(at + step + items.length) % items.length] ??
						(step === 1 ? items[0] : items.at(-1)))
		highlight(menu, next)
	}

	const typeahead = (menu: HTMLElement, current: HTMLElement | undefined, key: string) => {
		const now = Date.now()
		typed = now - typedAt > 600 ? key : typed + key
		typedAt = now
		const items = itemsOf(menu).filter(enabled)
		const start = current === undefined ? 0 : items.indexOf(current) + (typed.length === 1 ? 1 : 0)
		const ordered = [...items.slice(start), ...items.slice(0, start)]
		const found = ordered.find((item) =>
			(leaves.get(item)?.label ?? "").toLowerCase().startsWith(typed.toLowerCase()),
		)
		if (found !== undefined) highlight(menu, found)
	}

	const onKey = (menu: HTMLElement) => (event: KeyboardEvent) => {
		const target = event.target instanceof HTMLElement ? event.target : undefined
		const current = target?.closest<HTMLElement>("[data-hz-part=item]") ?? undefined
		const inSubmenu = menu === submenu
		const handled = () => {
			event.preventDefault()
			event.stopPropagation()
		}
		const step = stepFor(event.key)
		if (step !== undefined) {
			handled()
			move(menu, current, step)
		} else if (event.key === "Enter" || event.key === " ") {
			handled()
			if (current !== undefined) pick(current)
		} else if (event.key === "ArrowRight" && !inSubmenu && current?.hasAttribute("aria-haspopup")) {
			handled()
			pick(current)
		} else if ((event.key === "ArrowLeft" || event.key === "Escape") && inSubmenu) {
			handled()
			closeSubmenu(true)
		} else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
			handled()
			typeahead(menu, current, event.key)
		}
	}
	panel.addEventListener("keydown", onKey(panel))
	submenu.addEventListener("keydown", onKey(submenu))

	function close(restoreFocus = true) {
		const was = options
		if (was === undefined) return
		options = undefined
		closeSubmenu(false)
		stopPlacing?.()
		stopPlacing = undefined
		hidePanel(panel)
		flag(outer, "open", false)
		for (const item of itemsOf(panel)) flag(item, "highlighted", false)
		const closing = layer
		layer = undefined
		closing?.close({ restoreFocus })
		was.onClose?.()
	}

	const present = () => {
		const opening = options
		if (opening === undefined || layer !== undefined) return
		installOverlayStyles(document)
		const inPlace = isSpecimen(outer)
		flag(outer, "specimen", inPlace)
		flag(outer, "open", true)
		showPanel(panel, { modal: false, inPlace })
		if (inPlace) return
		stopPlacing = trackPlacement(panel, opening.anchor, opening.placement)
		layer = openLayer({
			panel,
			modal: false,
			dismissOnOutside: true,
			dismissOnTab: true,
			inside: () => [submenu, ...(opening.inside?.() ?? [])],
			initialFocus: "none",
			onDismiss: (reason) => {
				if (reason === "tab") {
					layer = undefined
					close(false)
				} else close(reason !== "outside")
			},
		})
		move(panel, undefined, opening.focus)
	}

	return {
		panel,
		setEntries: (value) => {
			groups = value ?? []
			render()
			if (options !== undefined && layer !== undefined) move(panel, undefined, "first")
		},
		setLabel: (label) => {
			if (label === "") panel.removeAttribute("aria-label")
			else panel.setAttribute("aria-label", label)
		},
		open: (next) => {
			if (options !== undefined) return
			options = next
			schedule(present)
		},
		close,
		isOpen: () => options !== undefined,
	}
}
