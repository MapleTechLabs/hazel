// Owned by lane A4 (`docs/hazel-ui.md`, "Phase 2: lanes"). `hz:item`: a sidebar row. The control (a
// link with `href`, else a button) is the row's box and holds the content parent, so slots never move.
import { definePrimitive, flag, option, part, type Primitive } from "../define.ts"
import { ensureSheet, fire, listens, textOf } from "../list/runtime.ts"

/** A touch held this long is a long press. */
const LONG_PRESS_MS = 500
/** A touch that drifts further than this many px is a scroll, not a press. */
const LONG_PRESS_SLOP = 10

// The thread elbow (`thread-elbow`, today's `threadBranch` in `channels-sidebar/items.ts`): from the
// row's bottom edge, the branch eases off the spine 27px up into the row's middle.
const BRANCH = "C1.75 -20 4 -16 11 -16"
const SPINE_THROUGH = `M1.75 0V-100M1.75 -27${BRANCH}`
const SPINE_TO_BRANCH = `M1.75 -100V-27${BRANCH}`

// What the recipe cannot say: slot order inside the row, the subtitle's second line, the elbow's
// position, and a disabled link taking no clicks.
const css = `
[data-hz="item"] > [data-hz-part="control"] { position: relative; }
[data-hz="item"] > [data-hz-part="control"] > [data-hz-part="title"],
[data-hz="item"] > [data-hz-part="control"] > [data-hz-part="subtitle"] { order: 1; min-width: 0; }
[data-hz="item"] > [data-hz-part="control"] > [data-hz-part="badge"] { order: 2; }
[data-hz="item"] > [data-hz-part="control"] > [data-hz-part="shortcut"] { order: 3; }
[data-hz="item"] > [data-hz-part="control"] > [data-hz-part="content"] > [data-hz-slot="trailing"] { order: 4; }
[data-hz="item"][data-subtitled] > [data-hz-part="control"] {
	display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto auto;
	grid-template-areas: "leading title badge shortcut trailing" "leading subtitle badge shortcut trailing";
	column-gap: var(--hz-space-2);
}
[data-hz="item"][data-subtitled] > [data-hz-part="control"] > [data-hz-part="content"] > [data-hz-slot="leading"] { grid-area: leading; }
[data-hz="item"][data-subtitled] > [data-hz-part="control"] > [data-hz-part="title"] { grid-area: title; }
[data-hz="item"][data-subtitled] > [data-hz-part="control"] > [data-hz-part="subtitle"] { grid-area: subtitle; }
[data-hz="item"][data-subtitled] > [data-hz-part="control"] > [data-hz-part="badge"] { grid-area: badge; }
[data-hz="item"][data-subtitled] > [data-hz-part="control"] > [data-hz-part="shortcut"] { grid-area: shortcut; }
[data-hz="item"][data-subtitled] > [data-hz-part="control"] > [data-hz-part="content"] > [data-hz-slot="trailing"] { grid-area: trailing; }
[data-hz="item"][data-nested] > [data-hz-part="control"] { margin-inline-start: calc(var(--hz-space-6) + var(--hz-space-0_5)); }
[data-hz="item"] > [data-hz-part="control"] > [data-hz-part="elbow"] {
	position: absolute; bottom: 0; inset-inline-start: calc(-1 * var(--hz-space-3));
	width: var(--hz-space-3); height: var(--hz-space-8); pointer-events: none;
	color: color-mix(in oklab, var(--hz-color-fg) 15%, transparent);
}
[data-hz="item"][data-disabled] > [data-hz-part="control"] { pointer-events: none; }
[data-hz="item"] > [data-hz-part="control"]:focus-visible {
	outline: 2px solid var(--hz-color-ring); outline-offset: -2px;
}
@media (forced-colors: active) {
	[data-hz="item"][data-selected] > [data-hz-part="control"] { outline: 1px solid Highlight; }
}
`

const elbowOf = (document: Document) => {
	const ns = "http://www.w3.org/2000/svg"
	const outerSvg = document.createElementNS(ns, "svg")
	outerSvg.setAttribute("data-hz-part", "elbow")
	outerSvg.setAttribute("aria-hidden", "true")
	const inner = document.createElementNS(ns, "svg")
	inner.setAttribute("y", "100%")
	inner.setAttribute("overflow", "visible")
	const path = document.createElementNS(ns, "path")
	path.setAttribute("fill", "none")
	path.setAttribute("stroke", "currentColor")
	path.setAttribute("stroke-width", "1.5")
	path.setAttribute("stroke-linecap", "round")
	inner.append(path)
	outerSvg.append(inner)
	return { node: outerSvg, path }
}

export const primitive = definePrimitive("item", ({ document, tag, outer }) => {
	ensureSheet(document, "item", css)
	const node = outer("div")
	const content = part(document, "span", "content")
	const title = part(document, "span", "title")
	const subtitle = part(document, "span", "subtitle")
	subtitle.hidden = true
	const badge = part(document, "span", "badge")
	badge.hidden = true
	const shortcut = part(document, "kbd", "shortcut")
	shortcut.hidden = true
	const elbow = elbowOf(document)
	let control: HTMLElement = part(document, "button", "control")
	control.setAttribute("type", "button")
	control.append(content, title, subtitle, badge, shortcut)
	node.append(control)

	let href: string | undefined
	let selected = false
	let disabled = false
	let badgeCount = 0

	// Link vs button: a new control takes the same parts, so the content parent never leaves the item
	// and the renderer's nodes are untouched. A disabled row is a disabled button, or a link with no href.
	const swap = () => {
		const wanted = href === undefined ? "BUTTON" : "A"
		if (control.tagName !== wanted) {
			const next = part(document, wanted.toLowerCase(), "control")
			if (wanted === "BUTTON") next.setAttribute("type", "button")
			next.append(...control.childNodes)
			control.replaceWith(next)
			control = next
		}
		if (control instanceof HTMLButtonElement) control.disabled = disabled
		if (control instanceof HTMLAnchorElement) {
			if (disabled) {
				control.removeAttribute("href")
				control.setAttribute("role", "link")
				control.setAttribute("aria-disabled", "true")
			} else {
				control.setAttribute("href", href ?? "")
				control.removeAttribute("role")
				control.removeAttribute("aria-disabled")
			}
		}
		if (selected) control.setAttribute("aria-current", "page")
		else control.removeAttribute("aria-current")
	}

	// A touch held still is a long press; the click that ends it is not a press.
	let hold: ReturnType<typeof setTimeout> | undefined
	let origin = { x: 0, y: 0 }
	const cancelHold = () => {
		if (hold !== undefined) clearTimeout(hold)
		hold = undefined
	}
	node.addEventListener("pointerdown", (event) => {
		if (event.pointerType === "mouse" || !listens(primitive, "longPress")) return
		origin = { x: event.clientX, y: event.clientY }
		cancelHold()
		hold = setTimeout(() => {
			hold = undefined
			if (!fire(primitive, "longPress")) return
			// Window capture runs before Effect UI's document delegation, so the press never fires.
			const view = document.defaultView
			const swallow = (click: Event) => {
				if (click.target instanceof Node && node.contains(click.target)) {
					click.preventDefault()
					click.stopPropagation()
				}
			}
			view?.addEventListener("click", swallow, { capture: true, once: true })
			setTimeout(() => view?.removeEventListener("click", swallow, { capture: true }), 800)
		}, LONG_PRESS_MS)
	})
	node.addEventListener("pointermove", (event) => {
		if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > LONG_PRESS_SLOP) cancelHold()
	})
	node.addEventListener("pointerup", cancelHold)
	node.addEventListener("pointercancel", cancelHold)
	node.addEventListener("contextmenu", (event) => {
		// The long press is the row's; the browser's touch callout would fight it.
		if (hold !== undefined) event.preventDefault()
	})

	const primitive: Primitive = {
		tag,
		outer: node,
		content,
		set: (name, value) => {
			if (name === "title") {
				title.textContent = textOf(value)
			} else if (name === "subtitle") {
				subtitle.textContent = textOf(value)
				subtitle.hidden = textOf(value) === ""
				flag(node, "subtitled", textOf(value) !== "")
			} else if (name === "badge") {
				badgeCount = typeof value === "number" ? value : 0
				badge.hidden = badgeCount <= 0
				badge.textContent = badgeCount > 0 ? String(badgeCount) : ""
			} else if (name === "shortcut") {
				shortcut.textContent = textOf(value)
				shortcut.hidden = textOf(value) === ""
				shortcut.setAttribute("aria-hidden", "true")
				if (textOf(value) === "") control.removeAttribute("aria-keyshortcuts")
				else control.setAttribute("aria-keyshortcuts", textOf(value))
			} else if (name === "href") {
				href = typeof value === "string" ? value : undefined
				swap()
			} else if (name === "selected") {
				selected = value === true
				flag(node, "selected", value)
				swap()
			} else if (name === "disabled") {
				disabled = value === true
				flag(node, "disabled", value)
				swap()
			} else if (name === "emphasized") flag(node, "emphasized", value)
			else if (name === "muted") flag(node, "muted", value)
			else if (name === "nested") {
				option(node, "nested", value)
				if (value === "middle" || value === "last") {
					elbow.path.setAttribute("d", value === "last" ? SPINE_TO_BRANCH : SPINE_THROUGH)
					if (!elbow.node.isConnected) control.prepend(elbow.node)
				} else elbow.node.remove()
			}
		},
		events: undefined,
	}
	return primitive
})
