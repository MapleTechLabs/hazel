// Owned by lane A1 (`docs/hazel-ui-phase4.md`, W2b). `hz:statTile`: today's KPI tile
// (`customers/ui/kpi-tile.ts`): a label that explains itself, the value, a delta and comparison, a
// sparkline in `chart`; loading skeletons, an empty tile with its `action`, a whole-tile link.
import { svg } from "../../icons.ts"
import { loop } from "../../motion.ts"
import { definePrimitive, flag, option, part, type Primitive } from "../define.ts"
import { ensureSheet, textOf } from "../list/runtime.ts"

const ROOT = '[data-hz="statTile"]'

/**
 * What the recipe cannot say: the stretched link and its focus ring, the definition card's hover and
 * focus reveal (a fixed card on a phone, `max-md`), the row the chart slot shares with the value,
 * skeleton blocks, and the empty tile's dashed edge.
 */
// Child chains only: the `chart` slot holds another primitive whose parts must not match.
const LABEL = `${ROOT} > [data-hz-part="label"]`
const TERM = `${LABEL} > [data-hz-part="term"]`
const DEFINITION = `${LABEL} > [data-hz-part="definition"]`
const ROW = `${ROOT} > [data-hz-part="row"]`
const FIGURE = `${ROW} > [data-hz-part="figure"]`
const FOOTER = `${ROOT} > [data-hz-part="footer"]`
const PLACEHOLDER = `${ROOT} > [data-hz-part="placeholder"]`
const SKELETON = `${PLACEHOLDER} > [data-hz-part="skeletons"] > [data-hz-part="skeleton"]`

const css = `
${ROOT} { position: relative; display: flex; flex-direction: column; min-width: 0; }
${ROOT}[data-linked] { transition: background-color var(--hz-duration-fast) ease-out; }
${ROOT}[data-linked]:hover { background: var(--hz-color-wash); }
${ROOT}[data-empty] { border-style: dashed; box-shadow: none; }
${ROOT} > [data-hz-part="link"] { position: absolute; inset: 0; border-radius: inherit; outline: none; }
${ROOT} > [data-hz-part="link"]:focus-visible { box-shadow: 0 0 0 2px color-mix(in oklab, var(--hz-color-ring) 70%, transparent); }
${LABEL} { display: inline-flex; min-width: 0; }
${ROOT}[data-linked] > [data-hz-part="label"] { position: relative; z-index: 10; align-self: flex-start; }
${LABEL}:has(> [data-hz-part="term"]) { position: relative; }
${TERM} {
	min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left;
	padding: 0; border: 0; background: none; font: inherit; color: inherit; cursor: help; outline: none;
}
${TERM}:is(:hover, :focus-visible) { color: var(--hz-color-fg); }
${DEFINITION} {
	position: absolute; top: 100%; left: 0; z-index: 20; width: calc(var(--hz-space-16) * 4);
	margin-top: var(--hz-space-2); pointer-events: none; visibility: hidden; opacity: 0;
	transition: opacity var(--hz-duration-fast) ease-out;
}
${LABEL}:is(:hover, :focus-within) > [data-hz-part="definition"] { visibility: visible; opacity: 1; }
@media (width < 48rem) {
	/* A phone: out of the layout until the label is tapped, then a card above the tab bar. */
	${DEFINITION} {
		display: none; position: fixed; inset-inline: var(--hz-space-4); top: auto; width: auto; margin-top: 0;
		bottom: calc(env(safe-area-inset-bottom) + var(--hz-space-16) + var(--hz-space-2));
	}
	${LABEL}:is(:hover, :focus-within) > [data-hz-part="definition"] { display: block; }
}
${ROW} {
	display: flex; flex-wrap: wrap; align-items: flex-end; min-width: 0;
	column-gap: var(--hz-space-4); row-gap: var(--hz-space-1_5);
}
/* A narrow tile wraps the detail under the value; the value keeps its width and the chart gives way. */
${FIGURE} {
	display: flex; flex-wrap: wrap; align-items: baseline; flex: none; min-width: 0; max-width: 100%;
	column-gap: var(--hz-space-2);
}
${FIGURE} > [data-hz-part="value"] { flex: none; }
${ROOT}[data-empty] > [data-hz-part="row"] > [data-hz-part="figure"] > [data-hz-part="value"] { color: var(--hz-color-muted-fg); }
${FIGURE} > [data-hz-part="detail"]:empty { display: none; }
${ROW} > [data-hz-slot="chart"] { display: flex; flex: 1 1 0; justify-content: flex-end; min-width: 0; }
${ROW} > [data-hz-slot="chart"] > * { min-width: 0; flex-shrink: 1; }
${ROW} > [data-hz-slot="action"] { flex: 1 0 100%; position: relative; z-index: 10; }
${FOOTER} { margin: 0; min-width: 0; }
${FOOTER}:not(:has(> :not(:empty))) { display: none; }
${FOOTER} > [data-hz-part="delta"] > svg { display: block; width: var(--hz-space-3_5); height: var(--hz-space-3_5); }
${FOOTER} > :is([data-hz-part="delta"], [data-hz-part="comparison"]):empty { display: none; }
${ROOT}:is([data-empty], [data-loading]) > [data-hz-part="footer"],
${ROOT}:is([data-empty], [data-loading]) > [data-hz-part="row"] > :is([data-hz-part="figure"] > [data-hz-part="detail"], [data-hz-slot="chart"]) { display: none; }
${ROOT}:not([data-empty]) > [data-hz-part="row"] > [data-hz-slot="action"] { display: none; }
${ROOT}[data-loading] > [data-hz-part="row"] { display: none; }
${PLACEHOLDER} { display: contents; }
${ROOT}:not([data-loading]) > [data-hz-part="placeholder"] { display: none; }
${PLACEHOLDER} > [data-hz-part="skeletons"] { display: flex; align-items: flex-end; justify-content: space-between; }
${SKELETON}, ${PLACEHOLDER} > [data-hz-part="skeletonLine"] { display: block; height: var(--hz-space-4); }
${SKELETON}[data-block="value"] { height: var(--hz-space-8); width: var(--hz-space-24); }
${SKELETON}[data-block="trend"] { width: var(--hz-space-20); border-radius: var(--hz-radius-sm); }
${PLACEHOLDER} > [data-hz-part="skeletonLine"] { width: calc(var(--hz-space-12) * 3); }
${ROOT} > [data-hz-part="loadingText"] {
	position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap;
}
`

/** The delta's arrow per `trend`; `none` has none (today's flat delta). */
const arrows: ReadonlyMap<string, string> = new Map([
	["up", "arrow-up"],
	["down", "arrow-down"],
])

/** The value line's dash, today's empty tile and a tile with no value yet. */
const DASH = String.fromCharCode(0x2014)

let counter = 0

export const primitive = definePrimitive("statTile", ({ document, tag, outer }) => {
	ensureSheet(document, "statTile", css)
	const node = outer("div")
	const id = `hz-stat-${++counter}`
	const link = part(document, "a", "link")
	const label = part(document, "span", "label")
	const term = part(document, "button", "term")
	term.setAttribute("type", "button")
	term.setAttribute("aria-describedby", `${id}-definition`)
	// An inner control: the host keeps its click from raising the tile's `press` (`host.ts`).
	term.dataset.hzInner = ""
	const definition = part(document, "span", "definition")
	definition.id = `${id}-definition`
	definition.setAttribute("role", "tooltip")

	// The value's row: the `chart` and `action` slots land here, the renderer's children.
	const row = part(document, "div", "row")
	const figure = part(document, "div", "figure")
	const value = part(document, "span", "value")
	const detail = part(document, "span", "detail")
	figure.append(value, detail)
	row.append(figure)

	const footer = part(document, "p", "footer")
	const delta = part(document, "span", "delta")
	const comparison = part(document, "span", "comparison")
	footer.append(delta, comparison)

	const placeholder = part(document, "div", "placeholder")
	placeholder.setAttribute("aria-hidden", "true")
	const placeholderOf = (name: string, partName = "skeleton") => {
		const skeleton = part(document, "span", partName)
		skeleton.dataset.block = name
		return skeleton
	}
	const skeletons = part(document, "div", "skeletons")
	const blocks = [
		placeholderOf("value"),
		placeholderOf("trend"),
		placeholderOf("line", "skeletonLine"),
	] as const
	skeletons.append(blocks[0], blocks[1])
	placeholder.append(skeletons, blocks[2])
	const loadingText = part(document, "span", "loadingText")
	node.append(label, row, footer, placeholder)

	let labelText = ""
	let definitionText = ""
	let valueText = ""
	let deltaText = ""
	let trend = "none"
	let href: string | undefined
	let loading = false

	const drawLabel = () => {
		if (definitionText === "") {
			label.replaceChildren(labelText)
			return
		}
		term.textContent = labelText
		definition.textContent = definitionText
		label.replaceChildren(term, definition)
	}
	const drawValue = () => {
		const empty = valueText === "" && !loading
		flag(node, "empty", empty)
		value.textContent = valueText === "" ? DASH : valueText
	}
	const drawDelta = () => {
		const arrow = arrows.get(trend)
		delta.innerHTML = deltaText === "" || arrow === undefined ? "" : svg(arrow)
		if (deltaText !== "") delta.append(deltaText)
	}
	const drawLink = () => {
		flag(node, "linked", href !== undefined)
		if (href === undefined) {
			link.remove()
			return
		}
		link.setAttribute("href", href)
		link.setAttribute("aria-label", `${labelText}: details`)
		if (link.parentNode !== node) node.prepend(link)
	}
	const drawLoading = () => {
		flag(node, "loading", loading)
		if (loading) {
			node.setAttribute("aria-busy", "true")
			loadingText.textContent = "Loading"
			placeholder.after(loadingText)
		} else {
			node.removeAttribute("aria-busy")
			loadingText.remove()
		}
		for (const skeleton of blocks) loop(skeleton, loading)
		drawValue()
	}

	const primitive: Primitive = {
		tag,
		outer: node,
		content: row,
		set: (name, next) => {
			if (name === "label") {
				labelText = textOf(next)
				drawLabel()
				drawLink()
			} else if (name === "definition") {
				definitionText = textOf(next)
				drawLabel()
			} else if (name === "value") {
				valueText = textOf(next)
				drawValue()
			} else if (name === "detail") detail.textContent = textOf(next)
			else if (name === "delta") {
				deltaText = textOf(next)
				drawDelta()
			} else if (name === "trend") {
				trend = typeof next === "string" ? next : "none"
				option(node, "trend", next)
				drawDelta()
			} else if (name === "deltaTone") option(node, "delta-tone", next)
			else if (name === "comparison") comparison.textContent = textOf(next)
			else if (name === "href") {
				href = typeof next === "string" && next !== "" ? next : undefined
				drawLink()
			} else if (name === "loading") {
				loading = next === true
				drawLoading()
			}
		},
		events: undefined,
	}
	drawValue()
	return primitive
})
