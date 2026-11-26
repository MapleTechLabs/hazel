// Owned by lane A4 (`docs/hazel-ui.md`, "Phase 2: lanes"). `hz:tabBar`: the selected tab's content over
// a bar of tabs (`tabs` data, `selected` id). A press or arrow key on a tab raises `change {id}`.
import { svg } from "../../icons.ts"
import { definePrimitive, part, type Plain, type Primitive } from "../define.ts"
import { ensureSheet, fire, textOf } from "../list/runtime.ts"

interface Tab {
	readonly id: string
	readonly label: string
	readonly icon: string
	readonly badge?: number
}

// SAFETY: the host only passes `tabs` that decoded as `Content.Tab` arrays (`spec.ts`).
const tabsOf = (value: Plain): ReadonlyArray<Tab> => (Array.isArray(value) ? (value as never) : [])

const css = `
[data-hz="tabBar"] { display: flex; flex-direction: column; min-height: 0; }
[data-hz="tabBar"] > [data-hz-part="panel"] { flex: 1 1 auto; min-height: 0; }
[data-hz="tabBar"] > [data-hz-part="bar"] { border-top: 1px solid var(--hz-color-separator); }
[data-hz="tabBar"] [data-hz-part="tab"] { position: relative; }
[data-hz="tabBar"] [data-hz-part="tab"]:focus-visible { outline: 2px solid var(--hz-color-ring); outline-offset: -2px; }
[data-hz="tabBar"] [data-hz-part="tabIcon"] > svg { display: block; width: 100%; height: 100%; }
[data-hz="tabBar"] [data-hz-part="tabBadge"] { position: absolute; top: var(--hz-space-1); inset-inline-start: calc(50% + var(--hz-space-1)); }
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

	const buttons = () => [...bar.querySelectorAll<HTMLButtonElement>("[role=tab]")]

	const choose = (id: string) => {
		if (id !== selected) fire(primitive, "change", { id })
	}

	const mark = () => {
		const current = tabs.some((tab) => tab.id === selected) ? selected : tabs[0]?.id
		for (const button of buttons()) {
			const on = button.dataset.id === current
			button.setAttribute("aria-selected", String(on))
			button.tabIndex = on ? 0 : -1
			if (on) {
				button.dataset.selected = ""
				panel.setAttribute("aria-labelledby", button.id)
			} else delete button.dataset.selected
		}
	}

	const draw = () => {
		bar.replaceChildren(
			...tabs.map((tab) => {
				const button = part(document, "button", "tab")
				button.setAttribute("type", "button")
				button.setAttribute("role", "tab")
				button.setAttribute("aria-controls", panel.id)
				button.id = `${panel.id}-${tab.id}`
				button.dataset.id = tab.id
				const icon = part(document, "span", "tabIcon")
				icon.setAttribute("aria-hidden", "true")
				icon.innerHTML = svg(tab.icon)
				const label = part(document, "span", "tabLabel")
				label.textContent = tab.label
				button.append(icon, label)
				if (tab.badge !== undefined && tab.badge > 0) {
					const badge = part(document, "span", "tabBadge")
					badge.textContent = String(tab.badge)
					button.append(badge)
				}
				button.addEventListener("click", () => choose(tab.id))
				return button
			}),
		)
		mark()
	}

	// Arrow keys move along the bar and select (automatic activation, as on iOS a tap does).
	bar.addEventListener("keydown", (event) => {
		const list = buttons()
		const at = list.indexOf(document.activeElement as HTMLButtonElement)
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
		const id = list[next]?.dataset.id
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
			}
		},
		events: undefined,
	}
	return primitive
})
