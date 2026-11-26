/**
 * What the overlay renderers share (lane A3): firing a semantic event, and the open/close cycle of
 * an overlay whose `open` the view controls. A dismiss (Escape, an outside press) is a request: the
 * view answers it by setting `open` false, and only then does the panel close and focus return.
 */
import { type DismissReason, type Layer, type LayerOptions, openLayer } from "../../focus/layers.ts"
import { hidePanel, installOverlayStyles, isSpecimen, showPanel, whenConnected } from "../../focus/surface.ts"
import { play, playThen, stop } from "../../motion.ts"
import { flag, type Plain, type Primitive } from "../define.ts"

/** Fires `event` through the primitive's handlers; false when the view does not listen. */
export const fire = (primitive: Primitive, event: string, payload: Plain = {}): boolean => {
	const events = primitive.events
	const handler = events?.handlers[event]
	return handler !== undefined && events !== undefined && events.dispatch(event, handler, payload)
}

export const textOf = (value: Plain): string => (typeof value === "string" ? value : "")

let ids = 0
/** A document-unique id for ARIA references. */
export const nextId = (prefix: string) => `hz-${prefix}-${(ids += 1).toString(36)}`

export interface OverlayConfig {
	readonly outer: HTMLElement
	readonly panel: HTMLElement
	readonly modal: boolean
	/** Extra layer options: focus target, inside elements, outside dismissal. */
	readonly layer?: () => Omit<LayerOptions, "panel" | "modal" | "onDismiss">
	/** Starts placing the panel once shown; returns the stop. */
	readonly place?: () => (() => void) | undefined
	readonly onDismiss: (reason: DismissReason) => void
	/** Runs just before the panel shows (measure what it will cover). */
	readonly beforeShow?: (inPlace: boolean) => void
	readonly onHide?: () => void
}

export interface Overlay {
	readonly setOpen: (open: boolean) => void
	readonly isShown: () => boolean
	/** Re-runs placement (content or anchor changed). */
	readonly replace: () => void
}

export const controlledOverlay = (config: OverlayConfig): Overlay => {
	// At create, not first open: a closed panel's hiding rule must be there before it draws.
	installOverlayStyles(config.outer.ownerDocument)
	const schedule = whenConnected(config.outer)
	let wanted = false
	let shown = false
	let layer: Layer | undefined
	let stopPlacing: (() => void) | undefined
	const hide = (restoreFocus: boolean) => {
		if (!shown) return
		shown = false
		flag(config.outer, "open", false)
		const closing = layer
		layer = undefined
		closing?.close({ restoreFocus })
		config.onHide?.()
		// The panel stays until its exit motion ends (none of today's overlays but a toast has one).
		stop(config.panel, "enter")
		playThen(config.panel, "exit", () => {
			if (shown) return
			stopPlacing?.()
			stopPlacing = undefined
			hidePanel(config.panel)
		})
	}
	const present = () => {
		if (wanted && !shown) {
			const inPlace = isSpecimen(config.outer)
			flag(config.outer, "specimen", inPlace)
			flag(config.outer, "open", true)
			config.beforeShow?.(inPlace)
			stop(config.panel, "exit")
			showPanel(config.panel, { modal: config.modal, inPlace })
			shown = true
			void play(config.panel, "enter")
			if (inPlace) return
			stopPlacing?.()
			stopPlacing = config.place?.()
			layer = openLayer({
				...config.layer?.(),
				panel: config.panel,
				modal: config.modal,
				onDismiss: (reason) => {
					// A parent overlay closed: this one hides with it, then tells the view.
					if (reason === "parent") {
						layer = undefined
						hide(false)
						wanted = false
					}
					config.onDismiss(reason)
				},
			})
		} else if (!wanted && shown) hide(true)
	}
	return {
		setOpen: (open) => {
			wanted = open
			schedule(present)
		},
		isShown: () => shown,
		replace: () => {
			if (!shown || stopPlacing === undefined) return
			stopPlacing()
			stopPlacing = config.place?.()
		},
	}
}
