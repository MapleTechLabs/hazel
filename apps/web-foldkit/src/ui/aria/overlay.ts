import type { Html, HtmlBuilder } from "foldkit/html"
import { calculatePosition, type Placement } from "./position"

/**
 * Imperative overlay plumbing shared by the overlay primitives (menu, select, popover, tooltip,
 * dialog, sheet). Each helper mirrors one React Aria hook and returns its cleanup, so a
 * primitive's Mount can pair setup and release with `Effect.acquireRelease`.
 */

// POSITIONING (useOverlayPosition)

export interface PositionConfig {
	readonly triggerId: string
	readonly placement: Placement
	readonly offset: number
	readonly crossOffset?: number
	readonly shouldFlip?: boolean
	/** `--trigger-width`, set by MenuTrigger and Select from the trigger's `offsetWidth`. */
	readonly isTriggerWidthSet?: boolean
	/** The arrow wrapper (OverlayArrow), positioned along the cross axis. */
	readonly arrowSelector?: string
	/** Defaults to 12, React Aria's `containerPadding`. */
	readonly containerPadding?: number
}

const CONTAINER_PADDING = 12
const OVERLAY_Z_INDEX = "100000"

/** Positions `overlay` against the trigger exactly as React Aria's `useOverlayPosition` does. */
export const positionOverlay = (overlay: HTMLElement, config: PositionConfig): (() => void) => {
	const trigger = document.getElementById(config.triggerId)
	if (trigger === null) return () => undefined
	const arrow = config.arrowSelector ? overlay.querySelector<HTMLElement>(config.arrowSelector) : null

	overlay.style.position = "absolute"
	overlay.style.zIndex = OVERLAY_Z_INDEX
	if (config.isTriggerWidthSet) overlay.style.setProperty("--trigger-width", `${trigger.offsetWidth}px`)

	const update = () => {
		overlay.style.top = "0px"
		overlay.style.bottom = ""
		overlay.style.maxHeight = `${window.visualViewport?.height ?? window.innerHeight}px`
		const result = calculatePosition({
			placement: config.placement.replace("start", "left").replace("end", "right") as Placement,
			overlayNode: overlay,
			targetNode: trigger,
			scrollNode: overlay,
			padding: config.containerPadding ?? CONTAINER_PADDING,
			shouldFlip: config.shouldFlip ?? true,
			boundaryElement: document.body,
			offset: config.offset,
			crossOffset: config.crossOffset ?? 0,
			maxHeight: undefined,
			arrowSize: arrow ? arrow.offsetWidth : 0,
			arrowBoundaryOffset: 0,
		})
		overlay.style.top = ""
		overlay.style.bottom = ""
		overlay.style.left = ""
		overlay.style.right = ""
		for (const [key, value] of Object.entries(result.position))
			overlay.style.setProperty(key, `${value}px`)
		overlay.style.maxHeight = result.maxHeight != null ? `${result.maxHeight}px` : ""
		overlay.style.setProperty(
			"--trigger-anchor-point",
			`${result.triggerAnchorPoint.x}px ${result.triggerAnchorPoint.y}px`,
		)
		overlay.setAttribute("data-placement", result.placement)
		if (arrow) {
			arrow.setAttribute("data-placement", result.placement)
			arrow.style.position = "absolute"
			arrow.style.transform =
				result.placement === "top" || result.placement === "bottom"
					? "translateX(-50%)"
					: "translateY(-50%)"
			for (const side of ["top", "bottom", "left", "right"]) arrow.style.removeProperty(side)
			arrow.style.setProperty(result.placement, "100%")
			if (result.arrowOffsetLeft != null) arrow.style.left = `${result.arrowOffsetLeft}px`
			if (result.arrowOffsetTop != null) arrow.style.top = `${result.arrowOffsetTop}px`
		}
	}

	update()
	const observer = new ResizeObserver(update)
	observer.observe(overlay)
	observer.observe(trigger)
	window.addEventListener("resize", update, false)
	return () => {
		observer.disconnect()
		window.removeEventListener("resize", update, false)
	}
}

// PORTAL AND MODALITY (Overlay, ariaHideOutside, usePreventScroll)

/**
 * Moves `element` to the end of `<body>` like React Aria's portal. A modal overlay also makes the
 * other body children inert and locks page scroll; non-modal ones (submenus, tooltips) only move.
 */
export const portalOverlay = (element: Element, options: { readonly isModal: boolean }): (() => void) => {
	document.body.appendChild(element)
	const releaseInert = options.isModal ? hideOutside(element) : () => undefined
	const releaseScroll = options.isModal ? preventScroll() : () => undefined
	return () => {
		releaseInert()
		releaseScroll()
		element.remove()
	}
}

const inertCounts = new WeakMap<Element, number>()

const hideOutside = (visible: Element): (() => void) => {
	const hidden = [...document.body.children].filter(
		(child) => child !== visible && !child.contains(visible) && child.tagName !== "SCRIPT",
	)
	for (const element of hidden) {
		const count = inertCounts.get(element) ?? 0
		if (count === 0) element.setAttribute("inert", "")
		inertCounts.set(element, count + 1)
	}
	return () => {
		for (const element of hidden) {
			const count = (inertCounts.get(element) ?? 1) - 1
			inertCounts.set(element, count)
			if (count === 0) element.removeAttribute("inert")
		}
	}
}

let scrollLocks = 0
let restoreScroll = () => undefined as void

const preventScroll = (): (() => void) => {
	if (scrollLocks++ === 0) {
		const root = document.documentElement
		const scrollbarWidth = window.innerWidth - root.clientWidth
		const previousOverflow = root.style.overflow
		const previousPadding = root.style.paddingRight
		if (scrollbarWidth > 0) root.style.paddingRight = `${scrollbarWidth}px`
		root.style.overflow = "hidden"
		restoreScroll = () => {
			root.style.overflow = previousOverflow
			root.style.paddingRight = previousPadding
			if (root.getAttribute("style") === "") root.removeAttribute("style")
		}
	}
	return () => {
		if (--scrollLocks === 0) restoreScroll()
	}
}

// DISMISS (useInteractOutside)

/**
 * Calls `onInteractOutside` on a pointer press that starts and ends outside every element matching
 * `insideSelector`, like React Aria. The pointerdown is prevented, so the press moves no focus.
 */
export const watchInteractOutside = (insideSelector: string, onInteractOutside: () => void): (() => void) => {
	let isPressStartedOutside = false
	const isOutside = (event: Event) =>
		event.target instanceof Element ? event.target.closest(insideSelector) === null : true
	const onPointerDown = (event: PointerEvent) => {
		isPressStartedOutside = isOutside(event)
		if (isPressStartedOutside) event.preventDefault()
	}
	const onPointerUp = (event: PointerEvent) => {
		if (isPressStartedOutside && isOutside(event)) onInteractOutside()
		isPressStartedOutside = false
	}
	document.addEventListener("pointerdown", onPointerDown, true)
	document.addEventListener("pointerup", onPointerUp, true)
	return () => {
		document.removeEventListener("pointerdown", onPointerDown, true)
		document.removeEventListener("pointerup", onPointerUp, true)
	}
}

// FOCUS (FocusScope restoreFocus)

/** Focuses the trigger again when an overlay that holds focus goes away (FocusScope `restoreFocus`). */
export const restoreFocusTo =
	(triggerId: string, overlay: Element): (() => void) =>
	() => {
		const active = document.activeElement
		if (active !== null && active !== document.body && !overlay.contains(active)) return
		document.getElementById(triggerId)?.focus({ preventScroll: true })
	}

// MARKUP

/** React Aria's visually hidden `DismissButton`, rendered at both ends of a modal popover. */
export const dismissButton = <Message>(h: HtmlBuilder<Message>, onDismiss: Message): Html =>
	h.div(
		[
			h.Attribute(
				"style",
				"border: 0px; clip: rect(0px, 0px, 0px, 0px); clip-path: inset(50%); height: 1px; margin: -1px; overflow: hidden; padding: 0px; position: absolute; width: 1px; white-space: nowrap;",
			),
		],
		[
			h.button([
				h.Attribute("aria-label", "Dismiss"),
				h.Attribute("tabindex", "-1"),
				h.Attribute("style", "width: 1px; height: 1px;"),
				h.OnClick(onDismiss),
			]),
		],
	)

/** The hidden sentinels FocusScope renders around contained content. */
export const focusScopeSentinel = <Message>(h: HtmlBuilder<Message>, edge: "start" | "end"): Html =>
	h.span([h.Attribute(`data-focus-scope-${edge}`, "true"), h.Attribute("hidden", "")])

/** The fixed underlay a modal popover renders behind itself. */
export const popoverUnderlay = <Message>(h: HtmlBuilder<Message>): Html =>
	h.div([h.Attribute("data-testid", "underlay"), h.Attribute("style", "position: fixed; inset: 0px;")])
