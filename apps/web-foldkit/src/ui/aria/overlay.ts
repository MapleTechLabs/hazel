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

/** The overlay positions in LTR, so logical `start`/`end` resolve to `left`/`right`. */
const logicalPlacements: Partial<Record<Placement, Placement>> = {
	start: "left",
	"start top": "left top",
	"start bottom": "left bottom",
	end: "right",
	"end top": "right top",
	"end bottom": "right bottom",
	"top start": "top left",
	"top end": "top right",
	"bottom start": "bottom left",
	"bottom end": "bottom right",
}
const physicalPlacement = (placement: Placement): Placement => logicalPlacements[placement] ?? placement

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
			placement: physicalPlacement(config.placement),
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
export const portalOverlay = (
	element: Element,
	options: { readonly isModal: boolean; readonly inertAfterPaint?: boolean },
): (() => void) => {
	document.body.appendChild(element)
	const releaseInert = options.isModal
		? hideOutside(element, options.inertAfterPaint ?? false)
		: () => undefined
	const releaseScroll = options.isModal ? preventScroll() : () => undefined
	const releaseStack = options.isModal ? pushOverlay() : () => undefined
	return () => {
		releaseStack()
		releaseInert()
		releaseScroll()
		element.remove()
	}
}

/** React Aria's `visibleOverlays`: only the topmost modal overlay reacts to outside presses. */
const overlayStack: Array<symbol> = []

const pushOverlay = (): (() => void) & { readonly isTopmost: () => boolean } => {
	const token = Symbol("overlay")
	overlayStack.push(token)
	const release = () => {
		const index = overlayStack.lastIndexOf(token)
		if (index !== -1) overlayStack.splice(index, 1)
	}
	return Object.assign(release, { isTopmost: () => overlayStack[overlayStack.length - 1] === token })
}

const inertCounts = new WeakMap<Element, number>()

/** React Aria keeps its live announcer and top-layer nodes reachable while an overlay hides the rest. */
const staysVisible = (element: Element) =>
	element.tagName === "SCRIPT" ||
	element.hasAttribute("data-live-announcer") ||
	element.hasAttribute("data-react-aria-top-layer")

/**
 * `inert` restyles the whole app (about 2,200 elements, 8 to 10ms). With `afterPaint` it lands in
 * the next frame, so the overlay paints in the frame that inserted it. Only for overlays whose own
 * hit-testable underlay takes the pointer at once; otherwise the hover leave would be missed.
 */
const hideOutside = (visible: Element, afterPaint: boolean): (() => void) => {
	const hidden = [...document.body.children].filter(
		(child) => child !== visible && !child.contains(visible) && !staysVisible(child),
	)
	let isApplied = false
	const apply = () => {
		isApplied = true
		for (const element of hidden) {
			const count = inertCounts.get(element) ?? 0
			if (count === 0) element.setAttribute("inert", "")
			inertCounts.set(element, count + 1)
		}
	}
	const frame = afterPaint ? requestAnimationFrame(apply) : null
	if (frame === null) apply()
	return () => {
		if (frame !== null) cancelAnimationFrame(frame)
		if (!isApplied) return
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

/**
 * ariaHideOutside as useComboBox uses it: every element outside `visible` gets aria-hidden, so
 * assistive technology only reaches the input and its listbox while the list is open.
 */
export const ariaHideOutside = (visible: ReadonlyArray<Element>): (() => void) => {
	const hidden: Array<Element> = []
	const walk = (parent: Element) => {
		for (const child of parent.children) {
			if (staysVisible(child) || visible.includes(child)) continue
			if (visible.some((element) => child.contains(element))) walk(child)
			else if (child.getAttribute("aria-hidden") !== "true") {
				child.setAttribute("aria-hidden", "true")
				hidden.push(child)
			}
		}
	}
	walk(document.body)
	return () => {
		for (const element of hidden) element.removeAttribute("aria-hidden")
	}
}

// DISMISS (useInteractOutside)

/**
 * Calls `onInteractOutside` on a pointer press that starts and ends outside every element matching
 * `insideSelector`, like React Aria. The pointerdown is prevented, so the press moves no focus.
 */
export const watchInteractOutside = (insideSelector: string, onInteractOutside: () => void): (() => void) => {
	let isPressStartedOutside = false
	const entry = pushOverlay()
	const isOutside = (event: Event) =>
		event.target instanceof Element ? event.target.closest(insideSelector) === null : true
	const onPointerDown = (event: PointerEvent) => {
		isPressStartedOutside = event.button === 0 && entry.isTopmost() && isOutside(event)
		if (isPressStartedOutside) event.preventDefault()
	}
	const onPointerUp = (event: PointerEvent) => {
		if (isPressStartedOutside && isOutside(event)) onInteractOutside()
		isPressStartedOutside = false
	}
	document.addEventListener("pointerdown", onPointerDown, true)
	document.addEventListener("pointerup", onPointerUp, true)
	return () => {
		entry()
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

/** FocusScope `contain`: Tab and Shift+Tab cycle through the tabbable elements inside `root`. */
export const containFocus = (root: HTMLElement | Element): (() => void) => {
	const selector =
		"a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]"
	const onKeyDown = (event: Event) => {
		if (
			!(event instanceof KeyboardEvent) ||
			event.key !== "Tab" ||
			event.altKey ||
			event.ctrlKey ||
			event.metaKey
		)
			return
		const tabbables = [...root.querySelectorAll<HTMLElement>(selector)].filter(
			(element) =>
				element.tabIndex >= 0 && !element.closest("[inert]") && element.getClientRects().length > 0,
		)
		event.preventDefault()
		if (tabbables.length === 0) return
		const index = tabbables.findIndex((element) => element === document.activeElement)
		const next = event.shiftKey
			? (tabbables[index <= 0 ? tabbables.length - 1 : index - 1] ?? tabbables[0])
			: (tabbables[index === -1 || index === tabbables.length - 1 ? 0 : index + 1] ?? tabbables[0])
		next?.focus()
	}
	// useFocusContainment's onBlur: a frame later, focus that fell to the body goes back to the
	// element that lost it. React has already rendered a fast reply by then, while Foldkit renders
	// it in that frame, so a pressed button that disabled itself takes focus once enabled again.
	let frame = 0
	let enabledObserver: MutationObserver | null = null
	const stopWaiting = () => {
		cancelAnimationFrame(frame)
		enabledObserver?.disconnect()
		enabledObserver = null
	}
	const isFocusLost = () => document.activeElement === null || document.activeElement === document.body
	const onFocusOut = (event: Event) => {
		const target = event.target
		stopWaiting()
		if (!(target instanceof HTMLElement)) return
		frame = requestAnimationFrame(() => {
			if (!isFocusLost() || !target.isConnected) return
			if (!(target instanceof HTMLButtonElement && target.disabled)) return target.focus()
			const observer = new MutationObserver(() => {
				if (target.disabled) return
				stopWaiting()
				if (isFocusLost() && target.isConnected) target.focus()
			})
			observer.observe(target, { attributes: true, attributeFilter: ["disabled"] })
			enabledObserver = observer
		})
	}
	root.addEventListener("keydown", onKeyDown)
	root.addEventListener("focusout", onFocusOut)
	document.addEventListener("focusin", stopWaiting)
	return () => {
		stopWaiting()
		root.removeEventListener("keydown", onKeyDown)
		root.removeEventListener("focusout", onFocusOut)
		document.removeEventListener("focusin", stopWaiting)
	}
}

// MODAL OVERLAY (useViewportSize, DialogHeader/DialogFooter resize observers)

/** ModalOverlay's `--visual-viewport-height` and `--page-height`. */
export const trackViewportHeight = (overlay: HTMLElement): (() => void) => {
	const update = () => {
		const scrolling = document.scrollingElement ?? document.documentElement
		const pageHeight = scrolling.scrollHeight - (scrolling.getBoundingClientRect().height % 1)
		overlay.style.setProperty(
			"--visual-viewport-height",
			`${window.visualViewport?.height ?? window.innerHeight}px`,
		)
		overlay.style.setProperty("--page-height", `${pageHeight}px`)
	}
	update()
	window.visualViewport?.addEventListener("resize", update)
	return () => window.visualViewport?.removeEventListener("resize", update)
}

/** DialogHeader and DialogFooter publish their heights on the dialog, which DialogBody's max height uses. */
export const observeDialogParts = (root: Element): (() => void) => {
	const parts = [
		["dialog-header", "--dialog-header-height"],
		["dialog-footer", "--dialog-footer-height"],
	] as const
	const observers = parts.flatMap(([slot, property]) => {
		const part = root.querySelector<HTMLElement>(`[data-slot="${slot}"]`)
		if (part === null) return []
		const observer = new ResizeObserver(() =>
			part.parentElement?.style.setProperty(property, `${part.clientHeight}px`),
		)
		observer.observe(part)
		return [observer]
	})
	return () => {
		for (const observer of observers) observer.disconnect()
	}
}

// MODAL POPOVER (Popover with an underlay, as MenuTrigger, Select and DialogTrigger render it)

/**
 * Everything a modal popover does on mount: portal `root` to the body with the rest inert and
 * scroll locked, position its `[data-popover]` panel, move focus in, dismiss on outside press,
 * and give focus back to the trigger on release.
 */
export const openModalPopover = (
	root: Element,
	config: PositionConfig &
		Readonly<{
			initialFocusId: string
			insideSelector: string
			onInteractOutside: () => void
			inertAfterPaint?: boolean
		}>,
): (() => void) => {
	const restoreFocus = restoreFocusTo(config.triggerId, root)
	const releasePortal = portalOverlay(root, {
		isModal: true,
		inertAfterPaint: config.inertAfterPaint ?? false,
	})
	const popover = root.querySelector<HTMLElement>("[data-popover]")
	const releasePosition = popover ? positionOverlay(popover, config) : () => undefined
	document.getElementById(config.initialFocusId)?.focus({ preventScroll: true })
	const releaseOutside = watchInteractOutside(config.insideSelector, config.onInteractOutside)
	return () => {
		releaseOutside()
		releasePosition()
		releasePortal()
		restoreFocus()
	}
}

/** FocusScope `restoreFocus` for overlays opened without a trigger: back to whatever had focus. */
export const restoreFocusToPrevious = (overlay: Element): (() => void) => {
	const previous = document.activeElement
	return () => {
		const active = document.activeElement
		if (active !== null && active !== document.body && !overlay.contains(active)) return
		if (previous instanceof HTMLElement) previous.focus({ preventScroll: true })
	}
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
