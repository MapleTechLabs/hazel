/**
 * `hz:popover` on the web (lane A3): a non-modal panel the view opens (`open`) and is asked to close
 * (`dismiss`: Escape, a press outside). It anchors at `anchorTo` (a run of a keyed leaf, such as a
 * pressed mention), else at its `anchor` slot, else at what had focus when it opened.
 *
 * The anchor slot and the children share one content parent, the panel. While closed the panel is
 * `display: contents`, so the anchor draws in place and the children are hidden; while open, a
 * placeholder holds the anchor's space and the anchor is pinned over it inside the top layer.
 */
import type { Rect } from "../../../vocabulary/Hazel.ts"
import { isLeafAnchor, resolveLeafAnchor, watchRunPresses } from "../../focus/anchors.ts"
import { tabbables } from "../../focus/focusable.ts"
import { measureNode } from "../../focus/measure.ts"
import { trackPlacement } from "../../focus/position.ts"
import { makePopoverPanel } from "../../focus/surface.ts"
import { definePrimitive, flag, part, type Plain, type Primitive } from "../define.ts"
import { controlledOverlay, fire } from "./overlay.ts"

const hasBox = (rect: Rect) => rect.width > 0 || rect.height > 0

export const primitive = definePrimitive("popover", ({ document, tag, outer }) => {
	const node = outer("div")
	const placeholder = part(document, "span", "placeholder")
	placeholder.hidden = true
	const panel = makePopoverPanel(part(document, "div", "panel"))
	panel.setAttribute("role", "dialog")
	node.append(placeholder, panel)
	watchRunPresses(document)

	let anchorTo: Plain | undefined
	let opener: Element | null = null

	const anchorSlot = () => panel.querySelector<HTMLElement>(":scope > [data-hz-slot=anchor]")
	/** The rect the panel opens next to, in the order the doc gives. */
	const anchorRect = (): Rect | undefined => {
		if (isLeafAnchor(anchorTo)) {
			const leaf = resolveLeafAnchor(document, anchorTo)
			if (leaf !== undefined) return measureNode(leaf)
		}
		if (!placeholder.hidden) return measureNode(placeholder)
		if (opener !== null && opener.isConnected) {
			const rect = measureNode(opener)
			if (hasBox(rect)) return rect
		}
		const view = document.defaultView
		return { x: (view?.innerWidth ?? 0) / 2, y: (view?.innerHeight ?? 0) / 3, width: 0, height: 0 }
	}

	/** Pins the anchor slot over the placeholder while the panel is in the top layer. */
	const pin = () => {
		const slot = anchorSlot()
		if (slot === null || isLeafAnchor(anchorTo)) return
		const rect = measureNode(slot)
		placeholder.hidden = false
		placeholder.style.width = `${rect.width}px`
		placeholder.style.height = `${rect.height}px`
		slot.dataset.pinned = ""
		slot.style.left = `${rect.x}px`
		slot.style.top = `${rect.y}px`
	}
	const unpin = () => {
		placeholder.hidden = true
		placeholder.removeAttribute("style")
		const slot = anchorSlot()
		if (slot === null) return
		delete slot.dataset.pinned
		slot.style.removeProperty("left")
		slot.style.removeProperty("top")
	}

	const overlay = controlledOverlay({
		outer: node,
		panel,
		modal: false,
		layer: () => ({
			dismissOnOutside: true,
			returnFocus: opener,
			// The first stop among the children, not the pinned anchor.
			initialFocus: () =>
				tabbables(panel).find((stop) => anchorSlot()?.contains(stop) !== true) ?? null,
		}),
		place: () => {
			const stop = trackPlacement(panel, anchorRect, { side: "bottom", align: "start", gap: 6 })
			// The pinned anchor follows the page too.
			const window = document.defaultView
			const follow = () => {
				const slot = anchorSlot()
				if (slot?.dataset.pinned === undefined) return
				const rect = measureNode(placeholder)
				slot.style.left = `${rect.x}px`
				slot.style.top = `${rect.y}px`
			}
			window?.addEventListener("scroll", follow, true)
			return () => {
				stop()
				window?.removeEventListener("scroll", follow, true)
			}
		},
		onDismiss: () => fire(primitive, "dismiss"),
		beforeShow: (inPlace) => {
			if (!inPlace) pin()
		},
		onHide: unpin,
	})

	const primitive: Primitive = {
		tag,
		outer: node,
		content: panel,
		set: (name, value) => {
			if (name === "open") {
				// Captured now: by the time the panel shows, focus has moved into it.
				if (value === true && !overlay.isShown()) opener = document.activeElement
				overlay.setOpen(value === true)
			} else if (name === "anchorTo") {
				anchorTo = value
				flag(node, "leaf-anchor", isLeafAnchor(value))
				overlay.replace()
			}
		},
		events: undefined,
	}
	return primitive
})
