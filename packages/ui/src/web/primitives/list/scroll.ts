// Owned by lane A4. The web's `scrollTo` command (`Hazel.Host`): a list scrolls its viewport, any
// other node scrolls itself when it scrolls, or else into view (`item.scrollTo`).
import type { ScrollTarget } from "../../../vocabulary/Hazel.ts"
import { rowId } from "./runtime.ts"

/** What a scrolling primitive does for `scrollTo`; the list registers one per element. */
export interface Scroller {
	readonly toEdge: (edge: "start" | "end") => void
	readonly rows: () => ReadonlyArray<HTMLElement>
}

const scrollers = new WeakMap<Element, Scroller>()

export const registerScroller = (node: Element, scroller: Scroller) => {
	scrollers.set(node, scroller)
}

const scrolls = (node: Element) => {
	const style = node.ownerDocument.defaultView?.getComputedStyle(node)
	const overflow = style === undefined ? "" : `${style.overflowY} ${style.overflowX}`
	return /auto|scroll/.test(overflow)
}

const reduced = (node: Element) =>
	node.ownerDocument.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true

/** Finds the row `key` names (see `rowId`), or undefined. */
const rowFor = (rows: ReadonlyArray<HTMLElement>, key: string) =>
	rows.find((row, index) => rowId(row, index) === key)

export const scrollTo = (node: unknown, target: ScrollTarget): void => {
	if (!(node instanceof Element)) return
	const scroller = scrollers.get(node)
	if (scroller !== undefined) {
		if ("to" in target) return scroller.toEdge(target.to)
		const row = rowFor(scroller.rows(), target.key)
		row?.scrollIntoView({ block: "nearest", behavior: reduced(node) ? "auto" : "smooth" })
		return
	}
	if ("to" in target && scrolls(node)) {
		node.scrollTo({
			top: target.to === "start" ? 0 : node.scrollHeight,
			left: 0,
			behavior: reduced(node) ? "auto" : "smooth",
		})
		return
	}
	// A row (`item.scrollTo`) or anything else: bring it into view in its nearest scroller.
	const block = "to" in target ? (target.to === "end" ? "end" : "start") : "nearest"
	node.scrollIntoView({ block, behavior: reduced(node) ? "auto" : "smooth" })
}
