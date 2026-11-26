/**
 * Anchored placement for overlays (lane A3): a panel goes on one side of an anchor rect, flips to the
 * other side when it does not fit, and shifts to stay inside the viewport, as the kit's Floating UI
 * setup does (`apps/web-foldkit/src/ui/aria/overlay.ts`, 12px viewport padding).
 */
import type { Rect } from "../../vocabulary/Hazel.ts"

export type Side = "bottom" | "top" | "right" | "left"
export type Align = "start" | "center" | "end"

export interface Placement {
	readonly side: Side
	readonly align: Align
	/** Gap between anchor and panel along the side, px. */
	readonly gap: number
}

export interface Size {
	readonly width: number
	readonly height: number
}

const PADDING = 12

const opposite = { bottom: "top", top: "bottom", right: "left", left: "right" } as const satisfies Record<
	Side,
	Side
>

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)))

/** Room along `side` of `anchor` inside `viewport`. */
const room = (side: Side, anchor: Rect, viewport: Size, gap: number) =>
	side === "bottom"
		? viewport.height - (anchor.y + anchor.height) - gap - PADDING
		: side === "top"
			? anchor.y - gap - PADDING
			: side === "right"
				? viewport.width - (anchor.x + anchor.width) - gap - PADDING
				: anchor.x - gap - PADDING

const along = (align: Align, start: number, length: number, size: number) =>
	align === "start" ? start : align === "end" ? start + length - size : start + (length - size) / 2

/** Where `panel` goes next to `anchor`: its top-left corner and the side it ended up on. */
export const place = (
	panel: Size,
	anchor: Rect,
	viewport: Size,
	placement: Placement,
): { readonly x: number; readonly y: number; readonly side: Side } => {
	const vertical = placement.side === "bottom" || placement.side === "top"
	const need = vertical ? panel.height : panel.width
	const flipped = opposite[placement.side]
	const side =
		room(placement.side, anchor, viewport, placement.gap) >= need ||
		room(placement.side, anchor, viewport, placement.gap) >=
			room(flipped, anchor, viewport, placement.gap)
			? placement.side
			: flipped
	const x = vertical
		? along(placement.align, anchor.x, anchor.width, panel.width)
		: side === "right"
			? anchor.x + anchor.width + placement.gap
			: anchor.x - placement.gap - panel.width
	const y = vertical
		? side === "bottom"
			? anchor.y + anchor.height + placement.gap
			: anchor.y - placement.gap - panel.height
		: along(placement.align, anchor.y, anchor.height, panel.height)
	return {
		x: clamp(x, PADDING, viewport.width - panel.width - PADDING),
		y: clamp(y, PADDING, viewport.height - panel.height - PADDING),
		side,
	}
}

const viewportOf = (document: Document): Size => ({
	width: document.documentElement.clientWidth || (document.defaultView?.innerWidth ?? 0),
	height: document.documentElement.clientHeight || (document.defaultView?.innerHeight ?? 0),
})

/** Sets `panel`'s fixed position next to `anchor` (`data-side` says where it landed). */
export const applyPlacement = (panel: HTMLElement, anchor: Rect, placement: Placement) => {
	const box = panel.getBoundingClientRect()
	const spot = place(
		{ width: box.width, height: box.height },
		anchor,
		viewportOf(panel.ownerDocument),
		placement,
	)
	panel.style.left = `${Math.round(spot.x)}px`
	panel.style.top = `${Math.round(spot.y)}px`
	panel.dataset.side = spot.side
}

/**
 * Keeps `panel` placed while it is open: on scroll anywhere and on resize, once per frame. Returns
 * the stop. `anchor` is read each time, so a moving trigger is followed.
 */
export const trackPlacement = (panel: HTMLElement, anchor: () => Rect | undefined, placement: Placement) => {
	const window = panel.ownerDocument.defaultView
	let frame: number | undefined
	const update = () => {
		frame = undefined
		const rect = anchor()
		if (rect !== undefined) applyPlacement(panel, rect, placement)
	}
	const schedule = () => {
		if (frame !== undefined || window === null) return
		frame = window.requestAnimationFrame(update)
	}
	update()
	window?.addEventListener("scroll", schedule, true)
	window?.addEventListener("resize", schedule)
	return () => {
		if (frame !== undefined) window?.cancelAnimationFrame(frame)
		window?.removeEventListener("scroll", schedule, true)
		window?.removeEventListener("resize", schedule)
	}
}
