// Owned by lane A4 (`docs/hazel-ui.md`, "Phase 2: lanes"). `hz:splitView`: today's app shell row
// (`ui/sidebar.ts`, `shell/app-shell.ts`) and side panel (`ui/split-panel.ts`): rail, sidebar, the
// content, then the detail panel. Slots never move: flex order places them.
import { definePrimitive, flag, part, type Primitive } from "../define.ts"
import { ensureSheet, fire } from "../list/runtime.ts"

/** Today's panel limits (`thread-width.ts`, `assistant/update.ts`): the narrowest panel, the content's floor. */
// HAZEL-GAP(p4-split-limits): today's thread and assistant panels each have their own limits.
const MIN_DETAIL = 320
const MIN_CONTENT = 400
/** Arrow keys have no layout to read, so they stop here (today's `MAX_KEYBOARD_WIDTH`). */
const MAX_DETAIL = 1200
/** Today's thread panel opens at 480px (`DEFAULT_THREAD_PANEL_WIDTH`). */
const DEFAULT_DETAIL = 480
/** The px an arrow key moves the focused edge (`split-panel.ts` `KEYBOARD_STEP`). */
const STEP = 24

const R = `[data-hz="splitView"]`
const RAIL = `${R} > [data-hz-slot="rail"]`
const SIDEBAR = `${R} > [data-hz-slot="sidebar"]`
const DETAIL = `${R} > [data-hz-slot="detail"]`
const EDGE = `${R} > [data-hz-part="edge"]`
const CONTENT = `${R} > :not([data-hz-slot], [data-hz-part="edge"])`
const tint = (percent: number) => `color-mix(in oklab, var(--hz-color-primary) ${percent}%, transparent)`

// Regular from 48rem, today's `md` (the dock's `md:flex`, the panels' `max-md:` cover, `MOBILE_QUERY`).
// The dock is 350px wide (`sidebarProvider` width) with a 3.25rem rail (`--sidebar-width-dock`) and its border.
const css = `
${R} {
	--hz-split-dock: 350px; --hz-split-rail: calc(var(--hz-space-12) + var(--hz-space-1) + var(--hz-space-px));
	position: relative; display: flex; flex-direction: column; min-height: 0; overflow: hidden;
}
${R} > [data-hz-slot] { box-sizing: border-box; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
${RAIL} { display: none; }
${SIDEBAR} { order: -1; }
/* HAZEL-GAP(p4-split-compact-sidebar): today's phone sidebar is a sheet the top bar opens. */
${R}[data-sidebar-collapsed] > [data-hz-slot="sidebar"] { display: none; }
${CONTENT} { flex: 1 1 auto; min-width: 0; min-height: 0; }
${EDGE} { display: none; }
/* Compact: the detail covers the content, full width, from the trailing edge (today's thread panel).
   HAZEL-GAP(p4-split-sheet-dismiss): no backdrop or swipe closes it; its own close button does. */
${DETAIL} {
	position: absolute; inset: 0; z-index: 20; overflow: hidden; background: var(--hz-color-bg);
	padding-block: env(safe-area-inset-top) env(safe-area-inset-bottom);
	animation: hz-split-sheet var(--hz-duration-normal) var(--hz-ease-out);
}
${R}:dir(rtl) > [data-hz-slot="detail"] { animation-name: hz-split-sheet-rtl; }
@keyframes hz-split-sheet { from { transform: translateX(100%); } }
@keyframes hz-split-sheet-rtl { from { transform: translateX(-100%); } }
@media (width >= 48rem) {
	${R} { flex-direction: row; }
	${RAIL} {
		display: flex; order: -2; flex: none; width: var(--hz-split-rail); overflow: hidden; align-items: center;
		background: var(--hz-color-sidebar); color: var(--hz-color-sidebar-fg);
		border-inline-end: 1px solid var(--hz-color-sidebar-border);
	}
	${SIDEBAR} {
		flex: none; width: var(--hz-split-dock); overflow: hidden; color: var(--hz-color-sidebar-fg);
		border-inline-end: 1px solid var(--hz-color-sidebar-border);
		transition: width var(--hz-duration-normal) var(--hz-ease-linear);
	}
	${R}:has(> [data-hz-slot="rail"]) > [data-hz-slot="sidebar"] { width: calc(var(--hz-split-dock) - var(--hz-split-rail)); }
	/* Collapsed: the dock keeps only its rail (today's \`collapsible="dock"\`). */
	${R}[data-sidebar-collapsed] > [data-hz-slot="sidebar"] {
		display: flex; width: 0; border-inline-end-width: 0; visibility: hidden;
		transition: width var(--hz-duration-normal) var(--hz-ease-linear), visibility 0s var(--hz-duration-normal);
	}
	${DETAIL} {
		position: relative; inset: auto; z-index: auto; order: 2; flex: 0 1 auto; padding-block: 0; animation: none;
		width: var(--hz-split-detail, ${DEFAULT_DETAIL}px); min-width: min(${MIN_DETAIL}px, 50%);
		border-inline-start: 1px solid var(--hz-color-border);
	}
	${R}[data-resizable]:has(> [data-hz-slot="detail"]) > [data-hz-part="edge"] {
		display: block; order: 1; flex: none; position: relative; z-index: 10; width: 0;
	}
}
/* The edge: a 6px strip centred on the panel's border, and a pill that shows on hover and focus. */
${EDGE} > [data-hz-part="handle"] {
	position: absolute; inset-block: 0; inset-inline-start: calc(var(--hz-space-1_5) / -2); width: var(--hz-space-1_5);
	cursor: col-resize; touch-action: none; background: transparent; outline: none;
	transition: background-color var(--hz-duration-fast) var(--hz-ease-out);
}
${EDGE} > [data-hz-part="handle"]:hover { background: ${tint(20)}; }
${EDGE} > [data-hz-part="handle"]:focus-visible { background: ${tint(30)}; box-shadow: inset 0 0 0 2px var(--hz-color-primary); }
${EDGE} > [data-hz-part="handle"]:active, ${R}[data-resizing] ${EDGE} > [data-hz-part="handle"] { background: ${tint(40)}; }
${EDGE} [data-hz-part="grip"] {
	position: absolute; top: 50%; inset-inline-start: 0; width: var(--hz-space-1); height: var(--hz-space-8);
	transform: translateY(-50%); border-radius: var(--hz-radius-full); background: var(--hz-color-border); opacity: 0;
	transition: opacity var(--hz-duration-fast) var(--hz-ease-out);
}
${EDGE} > [data-hz-part="handle"]:is(:hover, :focus-visible) > [data-hz-part="grip"] { opacity: 1; }
${R}[data-resizing] ${EDGE} [data-hz-part="grip"] { opacity: 1; background: var(--hz-color-primary); }
/* While the edge is dragged: no text selection, and frames never take the pointer (today's shell). */
${R}[data-resizing] { cursor: col-resize; user-select: none; }
${R}[data-resizing] iframe { pointer-events: none; }
@media (prefers-reduced-motion: reduce) {
	${SIDEBAR}, ${EDGE} > [data-hz-part="handle"], ${EDGE} [data-hz-part="grip"] { transition: none; }
	${DETAIL} { animation: none; }
}
`

const slotOf = (node: HTMLElement, name: string) =>
	Array.from(node.children).find((child) => (child as HTMLElement).dataset.hzSlot === name) as
		| HTMLElement
		| undefined

export const primitive = definePrimitive("splitView", ({ document, tag, outer }) => {
	ensureSheet(document, "splitView", css)
	const node = outer("div")
	const edge = part(document, "div", "edge")
	const handle = part(document, "div", "handle")
	const grip = part(document, "span", "grip")
	handle.append(grip)
	edge.append(handle)
	// HAZEL-GAP(p4-split-edge-label): the edge's name is today's per panel ("Resize thread panel").
	handle.setAttribute("aria-label", "Resize panel")
	handle.setAttribute("role", "separator")
	handle.setAttribute("aria-orientation", "vertical")
	handle.setAttribute("aria-valuemin", String(MIN_DETAIL))
	handle.setAttribute("aria-valuemax", String(MAX_DETAIL))
	handle.tabIndex = 0
	node.append(edge)

	let width = DEFAULT_DETAIL
	let drag:
		| { readonly id: number; readonly x: number; readonly start: number; readonly max: number }
		| undefined

	const show = (next: number) => {
		width = next
		node.style.setProperty("--hz-split-detail", `${next}px`)
		handle.setAttribute("aria-valuenow", String(next))
	}
	show(DEFAULT_DETAIL)

	const isRtl = () => document.defaultView?.getComputedStyle(node).direction === "rtl"
	// The room the content leaves: everything but the rail, sidebar and the content's floor.
	const roomFor = (detail: HTMLElement | undefined) => {
		const total = node.getBoundingClientRect().width
		if (total === 0 || detail === undefined) return MAX_DETAIL
		const docked = ["rail", "sidebar"].reduce(
			(sum, name) => sum + (slotOf(node, name)?.getBoundingClientRect().width ?? 0),
			0,
		)
		return Math.min(MAX_DETAIL, Math.max(MIN_DETAIL, total - docked - MIN_CONTENT))
	}
	const clamp = (next: number, max: number) => Math.round(Math.max(MIN_DETAIL, Math.min(next, max)))

	handle.addEventListener("pointerdown", (event) => {
		if (event.button !== 0) return
		event.preventDefault()
		const detail = slotOf(node, "detail")
		const start = detail?.getBoundingClientRect().width || width
		drag = { id: event.pointerId, x: event.clientX, start, max: roomFor(detail) }
		handle.setPointerCapture?.(event.pointerId)
		node.setAttribute("data-resizing", "")
	})
	handle.addEventListener("pointermove", (event) => {
		if (drag === undefined || event.pointerId !== drag.id) return
		const moved = isRtl() ? event.clientX - drag.x : drag.x - event.clientX
		show(clamp(drag.start + moved, drag.max))
	})
	const release = (event: PointerEvent) => {
		if (drag === undefined || event.pointerId !== drag.id) return
		drag = undefined
		handle.releasePointerCapture?.(event.pointerId)
		node.removeAttribute("data-resizing")
		fire(primitive, "resize", { width })
	}
	handle.addEventListener("pointerup", release)
	handle.addEventListener("pointercancel", release)
	handle.addEventListener("keydown", (event) => {
		const grow = isRtl() ? "ArrowRight" : "ArrowLeft"
		const shrink = isRtl() ? "ArrowLeft" : "ArrowRight"
		if (event.key !== grow && event.key !== shrink) return
		event.preventDefault()
		const next = clamp(width + (event.key === grow ? STEP : -STEP), MAX_DETAIL)
		if (next === width) return
		show(next)
		fire(primitive, "resize", { width: next })
	})

	const primitive: Primitive = {
		tag,
		outer: node,
		content: node,
		set: (name, value) => {
			if (name === "sidebarCollapsed") flag(node, "sidebar-collapsed", value)
			else if (name === "resizable") flag(node, "resizable", value)
			// A drag in progress keeps its own width until it is released.
			else if (name === "detailWidth" && drag === undefined)
				show(typeof value === "number" && value > 0 ? clamp(value, MAX_DETAIL) : DEFAULT_DETAIL)
		},
		events: undefined,
	}
	return primitive
})
