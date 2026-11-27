// Owned by lane A4 (`docs/hazel-ui.md`, "Phase 2: lanes"). `hz:tabBar`: the selected tab's content over
// a bar of tabs (`tabs` data, `selected` id). A press or arrow key on a tab raises `change {id}`.
// Phase 4: `style` `page` puts in-page tabs over the panel; `reorderable` tabs drag (`move {id, before}`).
import { svg } from "../../icons.ts"
import { attachReorder, reorderCss } from "../list/reorder.ts"
import { definePrimitive, flag, option, part, type Plain, type Primitive } from "../define.ts"
import { ensureSheet, fire, isPlainClick, textOf } from "../list/runtime.ts"

interface Tab {
	readonly id: string
	readonly label: string
	readonly icon?: string
	readonly tint?: string
	readonly badge?: number
	readonly href?: string
}

// SAFETY: the host only passes `tabs` that decoded as `Content.Tab` arrays (`spec.ts`).
const tabsOf = (value: Plain): ReadonlyArray<Tab> => (Array.isArray(value) ? (value as never) : [])

const ROOT = '[data-hz="tabBar"]'
const PAGE = `${ROOT}[data-style="page"]`
const PAGE_TAB = `${PAGE} > [data-hz-part="bar"] > [data-hz-part="tab"]`

// `page` (`tabs.styles.ts` horizontal): the first and last tab bleed by their gutter, the selected
// one is primary ink over a 2px underline that sits on the bar's border; hovers wash.
const pageCss = `
${PAGE} > [data-hz-part="bar"] { order: -1; position: relative; }
${PAGE_TAB} { text-decoration: none; cursor: pointer; }
${PAGE_TAB}:first-child { margin-inline-start: calc(-1 * var(--hz-space-2_5)); }
${PAGE_TAB}:hover { background: var(--hz-color-secondary); color: var(--hz-color-fg); }
${PAGE_TAB}[data-selected] { color: var(--hz-color-primary-subtle-fg); }
${PAGE_TAB}[data-selected]:hover { background: var(--hz-color-primary-subtle); }
${PAGE_TAB} > [data-hz-part="tabIcon"] { color: var(--hz-color-muted-fg); }
${PAGE_TAB} > :is([data-hz-part="tabIcon"], [data-hz-part="tabDot"]) { margin-inline-start: calc(-1 * var(--hz-space-0_5)); }
${PAGE_TAB}[data-selected] > [data-hz-part="tabIcon"] { color: var(--hz-color-primary-subtle-fg); }
${PAGE_TAB} > [data-hz-part="tabBadge"] { position: static; }
${PAGE_TAB}[data-selected]::after {
	content: ""; position: absolute; inset-inline: var(--hz-space-2_5); bottom: calc(-1 * (var(--hz-space-1) + 1px));
	height: 2px; border-radius: var(--hz-radius-full); background: var(--hz-color-primary-subtle-fg);
}
@media (width < 40rem) {
	/* A phone scrolls the tabs sideways; the extra pixel keeps the underline inside the scroller. */
	${PAGE} > [data-hz-part="bar"] { overflow-x: auto; scrollbar-width: none; padding-bottom: calc(var(--hz-space-1) + 1px); }
	${PAGE_TAB}[data-selected]::after { bottom: calc(-1 * var(--hz-space-1)); }
}
`

const css = `
${ROOT} { display: flex; flex-direction: column; min-height: 0; }
${ROOT} > [data-hz-part="panel"] { flex: 1 1 auto; min-height: 0; }
${ROOT}:not([data-style="page"]) > [data-hz-part="bar"] { border-top: 1px solid var(--hz-color-separator); }
${ROOT} [data-hz-part="tab"] { position: relative; }
${ROOT} [data-hz-part="tab"]:focus-visible { outline: 2px solid var(--hz-color-ring); outline-offset: -2px; }
${ROOT} [data-hz-part="tabIcon"] > svg { display: block; width: 100%; height: 100%; }
${ROOT} [data-hz-part="tabBadge"] { position: absolute; top: var(--hz-space-1); inset-inline-start: calc(50% + var(--hz-space-1)); }
${pageCss}
${reorderCss(`${ROOT} > [data-hz-part="bar"]`, "horizontal")}
`

let counter = 0

export const primitive = definePrimitive("tabBar", ({ document, tag, outer }) => {
	ensureSheet(document, "tabBar", css)
	const node = outer("div")
	const panel = part(document, "div", "panel")
	panel.setAttribute("role", "tabpanel")
	panel.id = `hz-tabpanel-${++counter}`
	const bar = part(document, "div", "bar")
	bar.setAttribute("role", "tablist")
	node.append(panel, bar)

	let tabs: ReadonlyArray<Tab> = []
	let selected = ""
	let reorderable = false

	const buttons = () => [...bar.querySelectorAll<HTMLElement>("[role=tab]")]

	const choose = (id: string) => {
		if (id !== selected) fire(primitive, "change", { id })
	}

	const reorder = attachReorder({
		container: bar,
		rows: buttons,
		enabled: () => reorderable,
		move: (id, before) => fire(primitive, "move", { id, before }),
		axis: "horizontal",
	})

	const mark = () => {
		const current = tabs.some((tab) => tab.id === selected) ? selected : tabs[0]?.id
		for (const button of buttons()) {
			const on = button.dataset.hzKey === current
			button.setAttribute("aria-selected", String(on))
			button.tabIndex = on ? 0 : -1
			if (on) {
				button.dataset.selected = ""
				panel.setAttribute("aria-labelledby", button.id)
			} else delete button.dataset.selected
		}
	}

	// A tab with `href` is a link (middle click, copy link); a plain click still raises `change`.
	const tabNode = (tab: Tab) => {
		if (tab.href === undefined) {
			const button = part(document, "button", "tab")
			button.setAttribute("type", "button")
			return button
		}
		const link = part(document, "a", "tab")
		link.setAttribute("href", tab.href)
		return link
	}

	const draw = () => {
		bar.replaceChildren(
			...tabs.map((tab) => {
				const button = tabNode(tab)
				button.setAttribute("role", "tab")
				button.setAttribute("aria-controls", panel.id)
				button.id = `${panel.id}-${tab.id}`
				// What `move` reports (`rowId`).
				button.dataset.hzKey = tab.id
				// A `tint` colours the icon, or is a dot when the tab has none (`pk0-tab-leading`).
				const tint = tab.tint === undefined ? undefined : `var(--hz-color-tint-${tab.tint})`
				if (tab.icon !== undefined) {
					const icon = part(document, "span", "tabIcon")
					icon.setAttribute("aria-hidden", "true")
					icon.innerHTML = svg(tab.icon)
					if (tint !== undefined) icon.style.color = tint
					button.append(icon)
				} else if (tint !== undefined) {
					const dot = part(document, "span", "tabDot")
					dot.setAttribute("aria-hidden", "true")
					const mark = part(document, "span", "tabDotMark")
					mark.style.backgroundColor = tint
					dot.append(mark)
					button.append(dot)
				}
				const label = part(document, "span", "tabLabel")
				label.textContent = tab.label
				button.append(label)
				if (tab.badge !== undefined && tab.badge > 0) {
					const badge = part(document, "span", "tabBadge")
					badge.textContent = String(tab.badge)
					button.append(badge)
				}
				button.addEventListener("click", (event) => {
					if (tab.href !== undefined) {
						if (!isPlainClick(event)) return
						event.preventDefault()
					}
					choose(tab.id)
				})
				return button
			}),
		)
		mark()
		reorder.sync()
	}

	// Arrow keys move along the bar and select (automatic activation, as on iOS a tap does); with
	// Alt they belong to reordering.
	bar.addEventListener("keydown", (event) => {
		if (event.altKey) return
		const list = buttons()
		const at = list.indexOf(document.activeElement as HTMLElement)
		if (at < 0) return
		const next =
			event.key === "ArrowRight"
				? (at + 1) % list.length
				: event.key === "ArrowLeft"
					? (at - 1 + list.length) % list.length
					: event.key === "Home"
						? 0
						: event.key === "End"
							? list.length - 1
							: undefined
		if (next === undefined) return
		event.preventDefault()
		list[next]?.focus()
		const id = list[next]?.dataset.hzKey
		if (id !== undefined) choose(id)
	})

	const primitive: Primitive = {
		tag,
		outer: node,
		content: panel,
		set: (name, value) => {
			if (name === "tabs") {
				tabs = tabsOf(value)
				draw()
			} else if (name === "selected") {
				selected = textOf(value)
				mark()
			} else if (name === "style") option(node, "style", value)
			else if (name === "reorderable") {
				reorderable = value === true
				flag(node, "reorderable", value)
				reorder.sync()
			}
		},
		events: undefined,
	}
	return primitive
})
