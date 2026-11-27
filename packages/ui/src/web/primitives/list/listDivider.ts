// Owned by lane A4 (`docs/hazel-ui.md`, "Phase 2: lanes"). `hz:listDivider`: a labelled rule between
// rows, a day (`date`, the label centred) or where unread begins (`unread`, the label at the end).
import { definePrimitive, option, part } from "../define.ts"
import { ensureSheet } from "./runtime.ts"

// The unread rule runs up to its label at the end; a recipe cannot drop a part. A day sticks to the
// list's top with its pill where today's stuck one sits (`top-0` in a `py-2` list, `my-2`),
// in the mono family (no mono caption step yet).
const css = `[data-hz="listDivider"][data-kind="unread"] > [data-hz-part="lineEnd"] { display: none; }
[data-hz="listDivider"]:not([data-kind="unread"]) { position: sticky; top: var(--hz-space-2); z-index: 1; }
[data-hz="listDivider"]:not([data-kind="unread"]) > [data-hz-part="label"] { font-family: var(--hz-font-mono); }
[data-hz="listDivider"][data-stuck] > :is([data-hz-part="lineStart"], [data-hz-part="lineEnd"]) { visibility: hidden; }`

/** The nearest scrolling ancestor, which a sticky day sticks to. */
const scrollerOf = (node: HTMLElement): HTMLElement | null => {
	const view = node.ownerDocument.defaultView
	for (let at = node.parentElement; at !== null; at = at.parentElement) {
		const overflow = view?.getComputedStyle(at).overflowY
		if (overflow === "auto" || overflow === "scroll") return at
	}
	return null
}

/**
 * While a day is stuck to the list's top it drops its rule (`divider-stuck-line`, today's `isStuck`):
 * stuck is cut by a root 1px under the sticky offset, with its top at or above the root's.
 */
const watchStuck = (node: HTMLElement) => {
	const view = node.ownerDocument.defaultView
	if (view === null || typeof view.IntersectionObserver !== "function") return
	let observer: IntersectionObserver | undefined
	const start = () => {
		if (!node.isConnected) return void view.requestAnimationFrame(start)
		const offset = Number.parseFloat(view.getComputedStyle(node).top) || 0
		observer = new view.IntersectionObserver(
			([entry]) => {
				if (entry === undefined || entry.rootBounds === null) return
				const stuck =
					node.dataset.kind !== "unread" &&
					entry.intersectionRatio < 1 &&
					entry.boundingClientRect.top <= entry.rootBounds.top + 0.5
				if (stuck) node.setAttribute("data-stuck", "")
				else node.removeAttribute("data-stuck")
			},
			{ root: scrollerOf(node), rootMargin: `-${offset + 1}px 0px 0px 0px`, threshold: [1] },
		)
		observer.observe(node)
	}
	view.requestAnimationFrame(start)
	return () => observer?.disconnect()
}

export const primitive = definePrimitive("listDivider", ({ document, tag, outer }) => {
	ensureSheet(document, "listDivider", css)
	const node = outer("div")
	node.setAttribute("role", "separator")
	const before = part(document, "span", "lineStart")
	const label = part(document, "span", "label")
	const after = part(document, "span", "lineEnd")
	label.hidden = true
	node.append(before, label, after)
	watchStuck(node)
	return {
		tag,
		outer: node,
		content: node,
		set: (name, value) => {
			if (name === "kind") option(node, "kind", value)
			else if (name === "label") {
				const text = typeof value === "string" ? value : ""
				label.textContent = text
				label.hidden = text === ""
				if (text === "") node.removeAttribute("aria-label")
				else node.setAttribute("aria-label", text)
			}
		},
		events: undefined,
	}
})
