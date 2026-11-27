// Owned by lane A4 (`docs/hazel-ui.md`, "Phase 2: lanes"). `hz:action`: a section's header action. A
// press, or with `entries` a menu button (`Hazel.actionMenu`) whose choice raises `select {id}`.
import { svg } from "../../icons.ts"
import { definePrimitive, part, type Plain, type Primitive } from "../define.ts"
import { ensureSheet, fire, textOf } from "../list/runtime.ts"

interface Leaf {
	readonly id: string
	readonly label: string
	readonly icon?: string
	readonly destructive?: boolean
	readonly disabled?: boolean
	readonly checked?: boolean
}
interface Entry extends Leaf {
	readonly entries?: ReadonlyArray<Leaf>
}
interface Group {
	readonly title?: string
	readonly entries: ReadonlyArray<Entry>
}

// SAFETY: the host only passes `entries` that decoded as `Content.MenuGroups` (`spec.ts`).
const groupsOf = (value: Plain): ReadonlyArray<Group> => (Array.isArray(value) ? (value as never) : [])

// The menu is drawn in the top layer (`popover`), outside the section, so its look is renderer CSS
// over tokens: the overlay surface of today's `ui/menu.ts`.
const css = `
[data-hz-menu] {
	position: fixed; inset: auto; margin: 0; min-width: calc(var(--hz-space-12) * 4);
	padding: var(--hz-space-1); border: 1px solid var(--hz-color-border); border-radius: var(--hz-radius-xl);
	background: var(--hz-color-bg); color: var(--hz-color-fg); box-shadow: var(--hz-shadow-xs);
	font-family: var(--hz-font-sans); font-size: var(--hz-text-label-size); line-height: var(--hz-text-label-leading);
}
[data-hz-menu] [data-hz-part="group"] + [data-hz-part="group"] {
	margin-top: var(--hz-space-1); padding-top: var(--hz-space-1); border-top: 1px solid var(--hz-color-border);
}
[data-hz-menu] [data-hz-part="groupTitle"] {
	padding: var(--hz-space-1) var(--hz-space-2); color: var(--hz-color-muted-fg);
	font-size: var(--hz-text-caption-size); line-height: var(--hz-text-caption-leading);
}
[data-hz-menu] [data-hz-part="entry"] {
	display: flex; align-items: center; gap: var(--hz-space-2); width: 100%;
	padding: var(--hz-space-1_5) var(--hz-space-2); border-radius: var(--hz-radius-md);
	text-align: start; background: none; border: 0; color: inherit; font: inherit; cursor: default;
}
[data-hz-menu] [data-hz-part="entry"]:focus-visible, [data-hz-menu] [data-hz-part="entry"]:hover,
[data-hz-menu] [data-hz-part="entry"][aria-expanded="true"] { background: var(--hz-color-wash-strong); outline: none; }
[data-hz-menu] [data-hz-part="entry"][data-destructive] { color: var(--hz-color-danger-subtle-fg); }
[data-hz-menu] [data-hz-part="entry"][aria-disabled="true"] { opacity: 0.5; }
[data-hz-menu] [data-hz-part="entryIcon"], [data-hz-menu] [data-hz-part="entryMark"] {
	display: block; width: var(--hz-space-4); height: var(--hz-space-4); flex: none;
}
[data-hz-menu] [data-hz-part="entryIcon"] { color: var(--hz-color-fg-2); }
[data-hz-menu] [data-hz-part="entryLabel"] { flex: 1 1 auto; }
[data-hz="action"]:focus-visible { outline: 2px solid var(--hz-color-ring); outline-offset: -2px; }
`

const iconSpan = (document: Document, name: string, icon: string | undefined) => {
	const span = part(document, "span", name)
	span.setAttribute("aria-hidden", "true")
	if (icon !== undefined) span.innerHTML = svg(icon)
	return span
}

export const primitive = definePrimitive("action", ({ document, outer, self }) => {
	ensureSheet(document, "action", css)
	const node = outer("button")
	node.setAttribute("type", "button")
	let groups: ReadonlyArray<Group> = []
	// Open menus, outermost first: the action's own, then at most one submenu.
	const open: Array<{ readonly menu: HTMLElement; readonly owner: HTMLElement }> = []

	const items = (menu: HTMLElement) =>
		[...menu.querySelectorAll<HTMLElement>(":scope > [data-hz-part=group] > [role^=menuitem]")].filter(
			(item) => item.getAttribute("aria-disabled") !== "true",
		)

	// Light dismiss: a press outside every open menu and the button closes them.
	const dismiss = (event: PointerEvent) => {
		const target = event.target
		if (!(target instanceof Node)) return
		if (node.contains(target) || open.some(({ menu }) => menu.contains(target))) return
		closeFrom(0, false)
	}

	const closeFrom = (depth: number, focusOwner: boolean) => {
		if (depth === 0 && open.length > 0) document.removeEventListener("pointerdown", dismiss, true)
		while (open.length > depth) {
			const top = open.pop()
			if (top === undefined) break
			top.owner.setAttribute("aria-expanded", "false")
			if (top.menu.matches(":popover-open")) top.menu.hidePopover()
			top.menu.remove()
			if (focusOwner && open.length === depth) top.owner.focus()
		}
	}

	const place = (menu: HTMLElement, owner: HTMLElement, side: "below" | "beside") => {
		const box = owner.getBoundingClientRect()
		const view = document.defaultView
		const width = view?.innerWidth ?? 0
		menu.style.top = `${side === "below" ? box.bottom + 4 : box.top}px`
		const left = side === "below" ? box.left : box.right + 4
		menu.style.left = `${Math.max(4, Math.min(left, width - menu.offsetWidth - 4))}px`
	}

	const build = (list: ReadonlyArray<Group>, depth: number, label: string): HTMLElement => {
		const menu = document.createElement("div")
		menu.dataset.hzMenu = ""
		menu.setAttribute("role", "menu")
		menu.setAttribute("aria-label", label)
		menu.setAttribute("popover", "manual")
		for (const group of list) {
			const section = part(document, "div", "group")
			section.setAttribute("role", "group")
			if (group.title !== undefined) {
				const heading = part(document, "div", "groupTitle")
				heading.textContent = group.title
				heading.id = `hz-menu-${Math.random().toString(36).slice(2)}`
				heading.setAttribute("role", "presentation")
				section.setAttribute("aria-labelledby", heading.id)
				section.append(heading)
			}
			for (const entry of group.entries) section.append(entryOf(entry, depth))
			menu.append(section)
		}
		menu.addEventListener("keydown", (event) => keys(event, menu, depth))
		return menu
	}

	const entryOf = (entry: Entry, depth: number) => {
		const item = part(document, "button", "entry")
		item.setAttribute("type", "button")
		item.tabIndex = -1
		const sub = depth === 0 && entry.entries !== undefined && entry.entries.length > 0
		item.setAttribute("role", entry.checked !== undefined ? "menuitemcheckbox" : "menuitem")
		if (entry.checked !== undefined) item.setAttribute("aria-checked", String(entry.checked))
		if (entry.disabled === true) item.setAttribute("aria-disabled", "true")
		if (entry.destructive === true) item.dataset.destructive = ""
		const label = part(document, "span", "entryLabel")
		label.textContent = entry.label
		item.append(iconSpan(document, "entryIcon", entry.icon), label)
		if (entry.checked === true) item.append(iconSpan(document, "entryMark", "check"))
		if (sub) {
			item.setAttribute("aria-haspopup", "menu")
			item.setAttribute("aria-expanded", "false")
			item.append(iconSpan(document, "entryMark", "chevron-right"))
		}
		item.addEventListener("click", () => {
			if (entry.disabled === true) return
			if (sub) return openMenu([{ entries: entry.entries ?? [] }], item, depth + 1, entry.label, true)
			closeFrom(0, true)
			fire(primitive, "select", { id: entry.id })
		})
		item.addEventListener("pointerenter", () => {
			item.focus()
			if (sub) openMenu([{ entries: entry.entries ?? [] }], item, depth + 1, entry.label, false)
			else closeFrom(depth + 1, false)
		})
		return item
	}

	const openMenu = (
		list: ReadonlyArray<Group>,
		owner: HTMLElement,
		depth: number,
		label: string,
		focusFirst: boolean,
	) => {
		if (open[depth]?.owner === owner) return
		closeFrom(depth, false)
		const menu = build(list, depth, label)
		document.body.append(menu)
		if (typeof menu.showPopover === "function") menu.showPopover()
		place(menu, owner, depth === 0 ? "below" : "beside")
		owner.setAttribute("aria-expanded", "true")
		if (open.length === 0) document.addEventListener("pointerdown", dismiss, true)
		open.push({ menu, owner })
		if (focusFirst) items(menu)[0]?.focus()
	}

	const keys = (event: KeyboardEvent, menu: HTMLElement, depth: number) => {
		const list = items(menu)
		const at = list.indexOf(document.activeElement as HTMLElement)
		const focus = (index: number) => list[(index + list.length) % list.length]?.focus()
		if (event.key === "ArrowDown") focus(at + 1)
		else if (event.key === "ArrowUp") focus(at - 1)
		else if (event.key === "Home") focus(0)
		else if (event.key === "End") focus(list.length - 1)
		else if (event.key === "Escape") closeFrom(depth, true)
		else if (event.key === "ArrowLeft" && depth > 0) closeFrom(depth, true)
		else if (event.key === "ArrowRight" && list[at]?.getAttribute("aria-haspopup") === "menu")
			list[at]?.click()
		else if (event.key === "Tab") return closeFrom(0, false)
		else return
		event.preventDefault()
		event.stopPropagation()
	}

	// A keyboard click (Enter, Space: `detail` 0) or ArrowDown opens it with the first entry focused.
	node.addEventListener("click", (event) => {
		if (groups.length === 0) return
		if (open.length > 0) closeFrom(0, true)
		else openMenu(groups, node, 0, node.getAttribute("aria-label") ?? "", event.detail === 0)
	})
	node.addEventListener("keydown", (event) => {
		if (groups.length === 0 || event.key !== "ArrowDown") return
		event.preventDefault()
		openMenu(groups, node, 0, node.getAttribute("aria-label") ?? "", true)
	})

	const primitive: Primitive = self(node, (name, value) => {
		if (name === "label") {
			if (textOf(value) === "") node.removeAttribute("aria-label")
			else node.setAttribute("aria-label", textOf(value))
		} else if (name === "entries") {
			groups = groupsOf(value)
			closeFrom(0, false)
			if (groups.length > 0) {
				node.setAttribute("aria-haspopup", "menu")
				node.setAttribute("aria-expanded", "false")
			} else {
				node.removeAttribute("aria-haspopup")
				node.removeAttribute("aria-expanded")
			}
		}
	})
	return primitive
})
