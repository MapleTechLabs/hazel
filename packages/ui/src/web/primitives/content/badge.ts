// Owned by lane A1 (`docs/hazel-ui.md`, "Phase 2: lanes").
import { glyph } from "../../icons.ts"
import { ensureSheet } from "../list/runtime.ts"
import { definePrimitive, flag, option, part, type Primitive } from "../define.ts"

// The severity bars (`severityGlyph`): three 3px bars, 4, 7 and 10px tall, lit up to the level.
// A truncated badge stops at today's `max-w-32`.
const css = `
[data-hz="badge"] > [data-hz-part="icon"][hidden], [data-hz="badge"] > [data-hz-part="detail"][hidden] { display: none; }
[data-hz="badge"] > img[data-hz-part="icon"] { object-fit: contain; }
[data-hz="badge"] > [data-hz-part="icon"][data-bars] { display: flex; align-items: flex-end; gap: 1.5px; width: var(--hz-space-3); height: var(--hz-space-3); }
[data-hz="badge"] > [data-hz-part="icon"][data-bars] > span { display: block; width: 3px; border-radius: var(--hz-radius-xs); background: var(--hz-color-severity-off); }
[data-hz="badge"] > [data-hz-part="icon"][data-bars] > span:nth-child(1) { height: var(--hz-space-1); }
[data-hz="badge"] > [data-hz-part="icon"][data-bars] > span:nth-child(2) { height: 7px; }
[data-hz="badge"] > [data-hz-part="icon"][data-bars] > span:nth-child(3) { height: var(--hz-space-2_5); }
[data-hz="badge"][data-severity="high"] > [data-hz-part="icon"] > span { background: var(--hz-color-severity-high); }
[data-hz="badge"][data-severity="medium"] > [data-hz-part="icon"] > span:nth-child(-n + 2) { background: var(--hz-color-severity-medium); }
[data-hz="badge"][data-severity="low"] > [data-hz-part="icon"] > span:nth-child(1) { background: var(--hz-color-severity-low); }
[data-hz="badge"][data-truncate] { max-width: calc(var(--hz-space-16) * 2); }
/* \`sourceChip\` is a bordered box, not the badge's inset ring: the border takes a pixel each side. */
[data-hz="badge"][data-size="large"][data-style="outline"] { box-shadow: none; border: 1px solid var(--hz-color-border); }
`

export const primitive = definePrimitive("badge", ({ document, tag, outer }) => {
	ensureSheet(document, "badge", css)
	const node = outer("span")
	const label = part(document, "span", "label")
	const detail = part(document, "span", "detail")
	detail.hidden = true
	let icon: HTMLElement = part(document, "span", "icon")
	icon.hidden = true
	node.append(icon, label, detail)
	let name: string | undefined
	let image: string | undefined
	let severity: string | undefined
	let truncate = false
	let title: string | undefined
	let plain = false
	// One leading element: the severity bars, else the picture, else the glyph.
	const lead = () => {
		const want =
			severity !== undefined && severity !== "none" ? "bars" : image !== undefined ? "img" : "span"
		const next = part(document, want === "img" ? "img" : "span", "icon")
		if (want === "bars") {
			next.dataset.bars = ""
			next.append(...[0, 1, 2].map(() => document.createElement("span")))
		} else if (want === "img") {
			next.setAttribute("src", image ?? "")
			next.setAttribute("alt", "")
		} else glyph(next, name)
		// A count's bars say its level (`signalCounts`); a chip's label says it already.
		if (want === "bars" && plain) {
			next.setAttribute("role", "img")
			next.setAttribute(
				"aria-label",
				`${(severity ?? "").replace(/^./, (c) => c.toUpperCase())} severity`,
			)
		} else next.setAttribute("aria-hidden", "true")
		next.hidden = want === "span" && name === undefined
		icon.replaceWith(next)
		icon = next
	}
	const hover = () => {
		const text = title ?? (truncate ? (label.textContent ?? undefined) : undefined)
		if (text === undefined || text === "") node.removeAttribute("title")
		else node.setAttribute("title", text)
	}
	const primitive: Primitive = {
		tag,
		outer: node,
		content: node,
		set: (prop, value) => {
			const text = typeof value === "string" ? value : undefined
			if (prop === "label") {
				label.textContent = text ?? ""
				hover()
			} else if (prop === "detail") {
				detail.textContent = text === undefined ? "" : text
				detail.hidden = text === undefined || text === ""
			} else if (prop === "icon") {
				name = text
				lead()
			} else if (prop === "image") {
				image = text
				lead()
			} else if (prop === "severity") {
				option(node, "severity", value)
				severity = text
				lead()
			} else if (prop === "title") {
				title = text
				hover()
			} else if (prop === "truncate") {
				truncate = value === true
				flag(node, "truncate", value)
				hover()
			} else if (prop === "pill") flag(node, "pill", value)
			else if (prop === "style") {
				option(node, prop, value)
				plain = value === "plain"
				lead()
			} else if (prop === "tone" || prop === "size") option(node, prop, value)
		},
		events: undefined,
	}
	return primitive
})
