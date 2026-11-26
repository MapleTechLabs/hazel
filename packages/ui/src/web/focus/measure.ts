/**
 * The web's `measure` command (lane A3): a node's box in viewport pixels, as Swift's reply gives it in
 * points. A primitive drawn with `display: contents` (a tooltip, a slot) has no box of its own, so it
 * measures as the union of what it draws; text measures through a Range.
 */
import type { Rect } from "../../vocabulary/Hazel.ts"

export const emptyRect: Rect = { x: 0, y: 0, width: 0, height: 0 }

const fromDom = (rect: DOMRect | DOMRectReadOnly): Rect => ({
	x: rect.left,
	y: rect.top,
	width: rect.width,
	height: rect.height,
})

const union = (rects: ReadonlyArray<Rect>): Rect | undefined => {
	const drawn = rects.filter((rect) => rect.width > 0 || rect.height > 0)
	if (drawn.length === 0) return undefined
	const left = Math.min(...drawn.map((rect) => rect.x))
	const top = Math.min(...drawn.map((rect) => rect.y))
	const right = Math.max(...drawn.map((rect) => rect.x + rect.width))
	const bottom = Math.max(...drawn.map((rect) => rect.y + rect.height))
	return { x: left, y: top, width: right - left, height: bottom - top }
}

const boxOf = (node: Node): Rect | undefined => {
	if (node instanceof Element) {
		if (node.getClientRects().length > 0) {
			const rect = fromDom(node.getBoundingClientRect())
			if (rect.width > 0 || rect.height > 0) return rect
		}
		return union([...node.childNodes].map(boxOf).filter((rect) => rect !== undefined))
	}
	if (node.nodeType === 3 && node.ownerDocument !== null) {
		const range = node.ownerDocument.createRange()
		range.selectNodeContents(node)
		const rect =
			typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : undefined
		return rect === undefined ? undefined : union([fromDom(rect)])
	}
	return undefined
}

/** `node`'s box; a node that draws nothing (detached, hidden) measures as the empty rect at 0,0. */
export const measureNode = (node: Node): Rect => (node.isConnected ? (boxOf(node) ?? emptyRect) : emptyRect)
