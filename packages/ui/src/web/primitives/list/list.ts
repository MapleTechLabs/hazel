// Owned by lane A4 (`docs/hazel-ui.md`, "Phase 2: lanes"). `hz:list`: rows in a scroll viewport.
// Every row stays mounted (the renderer owns them); rows far from the viewport skip layout and paint.
// A list fills the column it sits in, so its viewport, not the page, scrolls.
// The skeleton and edge spinners are renderer-owned (GAPS `skeleton`): their look is here, over tokens.
import { loop, onShow } from "../../motion.ts"
import { definePrimitive, flag, option, part, type Primitive } from "../define.ts"
import { attachReorder, reorderCss } from "./reorder.ts"
import { ensureSheet, fire, rowsOf } from "./runtime.ts"
import { registerScroller } from "./scroll.ts"

/** Skeleton rows drawn while `loading` (renderer-owned, GAPS `skeleton`). */
const SKELETON_ROWS = 6
/** At the end when this close to it, in px: what stick to bottom keeps. */
const END_SLOP = 2
/** How near an edge raises `reachStart` / `reachEnd`: half a viewport, at least this many px. */
const REACH_MIN = 64
/** Rows further than this many viewports away skip layout and paint (`content-visibility`). */
const RENDER_BAND = 2

const css = `
[data-hz="list"] { position: relative; display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
[data-hz="list"] > [data-hz-part="viewport"] {
	flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-anchor: none; overscroll-behavior: contain;
}
[data-hz="list"] > [data-hz-part="viewport"] > [data-hz-part="content"] { display: flex; flex-direction: column; }
/* Chat rhythm (today's \`mt-2\` on a group's first row, \`mb-2\` on its last, collapsed): 8px between
   author groups, none after a divider, 8px under the last row. */
[data-hz="list"] > [data-hz-part="viewport"] > [data-hz-part="content"] > [data-hz="message"]:not([data-grouped]):not([data-hz="listDivider"] + *) {
	margin-top: var(--hz-space-2);
}
[data-hz="list"] > [data-hz-part="viewport"] > [data-hz-part="content"] > [data-hz="message"]:last-child { margin-bottom: var(--hz-space-2); }
[data-hz="list"] > [data-hz-part="viewport"] > [data-hz-part="content"] > [data-hz-offscreen] {
	content-visibility: auto; contain-intrinsic-size: auto var(--hz-row-size, var(--hz-space-11));
}
[data-hz="list"][data-loading] > [data-hz-part="viewport"] > [data-hz-part="content"] > :not([data-hz="slot"]) { display: none; }
[data-hz="list"] > [data-hz-part="viewport"] > [data-hz-part="content"] > [data-hz-slot="overlay"] {
	position: absolute; inset-inline: 0; top: var(--hz-space-2); z-index: 1;
	display: flex; justify-content: center; pointer-events: none;
}
[data-hz="list"] > [data-hz-part="viewport"] > [data-hz-part="content"] > [data-hz-slot="overlay"] > * { pointer-events: auto; }
[data-hz="list"] [data-hz-part="spinner"] { animation: hz-list-pulse 1.4s var(--hz-ease-inOut) infinite; }
[data-hz="list"] [data-hz-part="skeleton"] {
	display: flex; flex-direction: column; gap: var(--hz-space-5); padding: var(--hz-space-4);
}
[data-hz="list"] [data-hz-part="skeletonRow"] { display: flex; align-items: flex-start; gap: var(--hz-space-3); }
[data-hz="list"] [data-hz-part="skeletonAvatar"] {
	flex: none; width: var(--hz-space-9); height: var(--hz-space-9); border-radius: var(--hz-radius-xl);
	background: var(--hz-color-muted);
}
[data-hz="list"] [data-hz-part="skeletonLines"] {
	display: flex; flex-direction: column; gap: var(--hz-space-2); flex: 1 1 auto; padding-block: var(--hz-space-1);
}
[data-hz="list"] [data-hz-part="skeletonLine"] {
	height: var(--hz-space-3); border-radius: var(--hz-radius-sm); background: var(--hz-color-muted);
}
[data-hz="list"] [data-hz-part="spinner"] {
	display: block; width: var(--hz-space-1_5); height: var(--hz-space-1_5); border-radius: var(--hz-radius-full);
	background: var(--hz-color-fg-2);
}
[data-hz="list"] [data-hz-part="spinner"]:nth-child(2) { animation-delay: 0.2s; }
[data-hz="list"] [data-hz-part="spinner"]:nth-child(3) { animation-delay: 0.4s; }
[data-hz="list"] [data-hz-part="skeletonRow"]:nth-child(3n + 2) [data-hz-part="skeletonLine"]:last-child { width: 40%; }
[data-hz="list"] [data-hz-part="skeletonRow"]:nth-child(3n) [data-hz-part="skeletonLine"]:last-child { width: 85%; }
[data-hz="list"] [data-hz-part="skeletonLine"]:first-child { width: 30%; }
@keyframes hz-list-pulse { 50% { opacity: 0.5; } }
@media (prefers-reduced-motion: reduce) {
	[data-hz="list"] [data-hz-part="spinner"] { animation: none; }
}
${reorderCss('[data-hz="list"] > [data-hz-part="viewport"] > [data-hz-part="content"]')}
`

const skeletonRows = (document: Document) => {
	const skeleton = part(document, "div", "skeleton")
	skeleton.setAttribute("aria-hidden", "true")
	// Fades in after a beat each time it shows, its shapes pulsing (`recipe.motion`, today's skeleton).
	onShow(skeleton, "enter")
	for (let index = 0; index < SKELETON_ROWS; index++) {
		const row = part(document, "div", "skeletonRow")
		const lines = part(document, "div", "skeletonLines")
		const placeholders = [
			part(document, "div", "skeletonAvatar"),
			part(document, "div", "skeletonLine"),
			part(document, "div", "skeletonLine"),
		] as const
		for (const placeholder of placeholders) loop(placeholder, true)
		lines.append(placeholders[1], placeholders[2])
		row.append(placeholders[0], lines)
		skeleton.append(row)
	}
	return skeleton
}

const loadingRow = (document: Document, name: string) => {
	const row = part(document, "div", name)
	row.setAttribute("role", "status")
	row.setAttribute("aria-label", "Loading")
	for (let dot = 0; dot < 3; dot++) row.append(part(document, "span", "spinner"))
	row.hidden = true
	return row
}

export const primitive = definePrimitive("list", ({ document, tag, outer }) => {
	ensureSheet(document, "list", css)
	const node = outer("div")
	const viewport = part(document, "div", "viewport")
	const skeleton = skeletonRows(document)
	skeleton.hidden = true
	const start = loadingRow(document, "loadingStart")
	const content = part(document, "div", "content")
	const end = loadingRow(document, "loadingEnd")
	viewport.append(skeleton, start, content, end)
	node.append(viewport)

	const props = {
		anchor: "start",
		stickToBottom: false,
		loading: false,
		loadingStart: false,
		loadingEnd: false,
		reorderable: false,
	}
	const rows = () => rowsOf(content)

	// What anchoring keeps still: the first row showing, and how far its top sits below the viewport's.
	let anchorRow: HTMLElement | undefined
	let anchorOffset = 0
	// Resting at the end: set on reaching it, cleared only by scrolling up (a resize never clears it).
	let atEnd = true
	let lastTop = 0
	let lastHeight = 0
	// Until the first rows arrive (and loading ends), an `end` list has not been put at its end yet.
	let settled = false
	let armedStart = true
	let armedEnd = true
	let rowCount = 0

	const firstVisible = (list: ReadonlyArray<HTMLElement>, top: number) => {
		let low = 0
		let high = list.length - 1
		let found: HTMLElement | undefined
		while (low <= high) {
			const middle = (low + high) >> 1
			const row = list[middle]
			if (row === undefined) break
			if (row.getBoundingClientRect().bottom > top) {
				found = row
				high = middle - 1
			} else low = middle + 1
		}
		return found
	}

	const toEnd = () => {
		viewport.scrollTop = viewport.scrollHeight
		atEnd = true
	}

	/** Reads the anchor, whether the list rests at its end, and raises reach events. */
	const record = () => {
		const top = viewport.getBoundingClientRect().top
		anchorRow = firstVisible(rows(), top)
		anchorOffset = anchorRow === undefined ? 0 : anchorRow.getBoundingClientRect().top - top
		const remaining = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
		if (remaining <= END_SLOP) atEnd = true
		else if (viewport.scrollTop < lastTop && viewport.scrollHeight === lastHeight) atEnd = false
		lastTop = viewport.scrollTop
		lastHeight = viewport.scrollHeight
		if (!settled || props.loading || rowCount === 0) return
		const near = Math.max(REACH_MIN, viewport.clientHeight / 2)
		if (viewport.scrollTop > near) armedStart = true
		else if (armedStart && !props.loadingStart) {
			armedStart = false
			fire(primitive, "reachStart")
		}
		if (remaining > near) armedEnd = true
		else if (armedEnd && !props.loadingEnd) {
			armedEnd = false
			fire(primitive, "reachEnd")
		}
	}

	/** After rows or sizes change, before paint: keep the anchor row still, or stay at the end. */
	const adjust = () => {
		const list = rows()
		if (list.length !== rowCount) {
			rowCount = list.length
			armedStart = true
			armedEnd = true
			reorder.sync()
			band()
		}
		if (!settled) {
			if (list.length === 0 || props.loading) return
			settled = true
			if (props.anchor === "end") toEnd()
			return record()
		}
		if (props.stickToBottom && atEnd) toEnd()
		else if (
			anchorRow !== undefined &&
			anchorRow.isConnected &&
			(props.anchor === "end" || viewport.scrollTop > 0)
		) {
			const offset = anchorRow.getBoundingClientRect().top - viewport.getBoundingClientRect().top
			const delta = offset - anchorOffset
			if (delta !== 0) viewport.scrollTop += delta
		}
		record()
	}

	// Far rows skip rendering; the band follows the viewport (an IntersectionObserver per list).
	const win = document.defaultView
	const intersections =
		win?.IntersectionObserver === undefined
			? undefined
			: new win.IntersectionObserver(
					(entries) => {
						for (const entry of entries) {
							const row = entry.target as HTMLElement
							if (entry.isIntersecting) delete row.dataset.hzOffscreen
							else {
								// Skipped at its measured height, so leaving the band never moves the rows below it.
								const height = entry.boundingClientRect.height
								if (height > 0) row.style.setProperty("--hz-row-size", `${height}px`)
								row.dataset.hzOffscreen = ""
							}
						}
					},
					{ root: viewport, rootMargin: `${RENDER_BAND * 100}% 0px` },
				)
	const observed = new Set<Element>()
	const band = () => {
		if (intersections === undefined) return
		const now = new Set<Element>(rows())
		for (const row of observed) if (!now.has(row)) intersections.unobserve(row)
		for (const row of now) if (!observed.has(row)) intersections.observe(row)
		observed.clear()
		for (const row of now) observed.add(row)
	}

	const reorder = attachReorder({
		container: content,
		rows,
		enabled: () => props.reorderable,
		move: (id, before) => fire(primitive, "move", { id, before }),
	})

	viewport.addEventListener("scroll", record, { passive: true })
	if (win?.MutationObserver !== undefined)
		new win.MutationObserver(adjust).observe(content, { childList: true })
	if (win?.ResizeObserver !== undefined) {
		const resizes = new win.ResizeObserver(adjust)
		resizes.observe(content)
		resizes.observe(viewport)
		resizes.observe(start)
		resizes.observe(end)
	}

	registerScroller(node, {
		rows,
		toEdge: (edge) => {
			if (edge === "end") toEnd()
			else {
				viewport.scrollTop = 0
				atEnd = false
			}
			record()
		},
	})

	const primitive: Primitive = {
		tag,
		outer: node,
		content,
		set: (name, value) => {
			if (name === "anchor") {
				props.anchor = value === "end" ? "end" : "start"
				option(node, "anchor", value)
				// A chat reads as a log: new rows are announced politely.
				if (props.anchor === "end") node.setAttribute("role", "log")
				else node.removeAttribute("role")
				return
			}
			if (
				name !== "stickToBottom" &&
				name !== "loading" &&
				name !== "loadingStart" &&
				name !== "loadingEnd" &&
				name !== "reorderable"
			)
				return
			props[name] = value === true
			flag(node, name, value)
			if (name === "loading") {
				skeleton.hidden = value !== true
				if (value === true) node.setAttribute("aria-busy", "true")
				else node.removeAttribute("aria-busy")
				queueMicrotask(adjust)
			} else if (name === "loadingStart") {
				start.hidden = value !== true
				if (value !== true) armedStart = true
				queueMicrotask(adjust)
			} else if (name === "loadingEnd") {
				end.hidden = value !== true
				if (value !== true) armedEnd = true
				queueMicrotask(adjust)
			} else if (name === "reorderable") reorder.sync()
		},
		events: undefined,
	}
	return primitive
})
