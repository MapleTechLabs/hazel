import { Anchor } from "@foldkit/ui"
import { Effect, type Scope } from "effect"
import * as Dom from "foldkit/dom"
import { type Placement, toAnchorPlacement } from "./placement"

/**
 * Overlay plumbing the menu, select, combo box, date picker, command menu and picker popovers share.
 * Each helper returns its cleanup (or is a scoped Effect), so a primitive's Mount pairs setup and
 * release. Positioning, portals, scroll locks and inert isolation come from Foldkit, which keeps
 * their reference counts; the helpers here hold no state of their own.
 */

// POSITIONING

export interface PositionConfig {
	readonly triggerId: string
	readonly placement: Placement
	/** The gap along the main axis. */
	readonly offset: number
	readonly crossOffset?: number
	/** `--trigger-width`, set by MenuTrigger and Select from the trigger's width. */
	readonly isTriggerWidthSet?: boolean
}

const VIEWPORT_PADDING = 12
const OVERLAY_Z_INDEX = "100000"

/**
 * Anchors `overlay` to the trigger with Floating UI: it flips and shifts inside the viewport, caps
 * its height to the space left, and publishes `--button-width` and `data-placement`.
 */
export const positionOverlay = (overlay: HTMLElement, config: PositionConfig): (() => void) => {
	overlay.style.position = "absolute"
	overlay.style.zIndex = OVERLAY_Z_INDEX
	const trigger = document.getElementById(config.triggerId)
	if (config.isTriggerWidthSet && trigger !== null)
		overlay.style.setProperty("--trigger-width", `${trigger.offsetWidth}px`)
	return Anchor.anchorSetup(overlay, {
		buttonId: config.triggerId,
		anchor: {
			placement: toAnchorPlacement(config.placement),
			gap: config.offset,
			offset: config.crossOffset ?? 0,
			padding: VIEWPORT_PADDING,
			portal: false,
		},
		interceptTab: false,
	})
}

// PORTAL AND ISOLATION

/**
 * Moves `element` out of its ancestors' clipping: to Foldkit's portal root, or into the `<dialog>`
 * it renders in, so an overlay opened from a modal stays above the modal and interactive.
 */
export const portalOverlay = (element: Element): (() => void) => Anchor.portalToContainingRoot(element)

const OVERLAY_ROOT_ATTRIBUTE = "data-overlay-root"

/**
 * A modal overlay: page scroll locks and everything outside `root` turns inert (after the next
 * commit, so the overlay paints first). `key` names the overlay; `root` is marked with it, so
 * outside presses can tell the topmost modal overlay.
 */
export const isolateOverlay = (root: Element, key: string): Effect.Effect<void, never, Scope.Scope> =>
	Effect.gen(function* () {
		yield* Effect.acquireRelease(
			Effect.sync(() => root.setAttribute(OVERLAY_ROOT_ATTRIBUTE, key)),
			() => Effect.sync(() => root.removeAttribute(OVERLAY_ROOT_ATTRIBUTE)),
		)
		yield* Effect.acquireRelease(Dom.lockScroll, () => Dom.unlockScroll)
		yield* Effect.acquireRelease(
			Dom.inertOthers(key, [`[${OVERLAY_ROOT_ATTRIBUTE}="${CSS.escape(key)}"]`]),
			() => Dom.restoreInert(key),
		)
	})

/**
 * ariaHideOutside as useComboBox uses it: every element outside `visible` gets aria-hidden, so
 * assistive technology only reaches the input and its listbox while the list is open.
 */
export const ariaHideOutside = (visible: ReadonlyArray<Element>): (() => void) => {
	const hidden: Array<Element> = []
	const walk = (parent: Element) => {
		for (const child of parent.children) {
			if (visible.includes(child)) continue
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

/** The overlay opened last is the one an outside press dismisses. */
const isTopmost = (root: Element) => {
	const roots = document.querySelectorAll(`[${OVERLAY_ROOT_ATTRIBUTE}]`)
	return roots.length === 0 || roots[roots.length - 1] === root
}

/**
 * Calls `onInteractOutside` on a pointer press that starts and ends outside every element matching
 * `insideSelector`, while `root` is the topmost modal overlay. The pointerdown is prevented, so the
 * press moves no focus.
 */
export const watchInteractOutside = (
	root: Element,
	insideSelector: string,
	onInteractOutside: () => void,
): (() => void) => {
	let isPressStartedOutside = false
	const isOutside = (event: Event) =>
		event.target instanceof Element ? event.target.closest(insideSelector) === null : true
	const onPointerDown = (event: PointerEvent) => {
		isPressStartedOutside = event.button === 0 && isTopmost(root) && isOutside(event)
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

// FOCUS (FocusScope restoreFocus and contain)

/** Focuses the trigger again when an overlay that holds focus goes away (FocusScope `restoreFocus`). */
export const restoreFocusTo =
	(triggerId: string, overlay: Element): (() => void) =>
	() => {
		const active = document.activeElement
		if (active !== null && active !== document.body && !overlay.contains(active)) return
		document.getElementById(triggerId)?.focus({ preventScroll: true })
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

/** FocusScope `contain`: Tab and Shift+Tab cycle through the tabbable elements inside `root`. */
export const containFocus = (root: Element): (() => void) => {
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

// MODAL POPOVER (Popover with an underlay, as MenuTrigger, Select and DialogTrigger render it)

/**
 * Everything a modal popover does while mounted: portal `root`, isolate the page, anchor its
 * `[data-popover]` panel, move focus in, dismiss on an outside press, and give focus back to the
 * trigger on release.
 */
export const openModalPopover = (
	root: Element,
	config: PositionConfig &
		Readonly<{
			initialFocusId: string
			insideSelector: string
			onInteractOutside: () => void
		}>,
): Effect.Effect<void, never, Scope.Scope> =>
	Effect.gen(function* () {
		yield* Effect.acquireRelease(
			Effect.sync(() => {
				const restoreFocus = restoreFocusTo(config.triggerId, root)
				const releasePortal = portalOverlay(root)
				return () => {
					releasePortal()
					restoreFocus()
				}
			}),
			(release) => Effect.sync(release),
		)
		yield* isolateOverlay(root, config.insideSelector)
		yield* Effect.acquireRelease(
			Effect.sync(() => {
				const popover = root.querySelector<HTMLElement>("[data-popover]")
				const releasePosition = popover ? positionOverlay(popover, config) : () => undefined
				document.getElementById(config.initialFocusId)?.focus({ preventScroll: true })
				const releaseOutside = watchInteractOutside(
					root,
					config.insideSelector,
					config.onInteractOutside,
				)
				return () => {
					releaseOutside()
					releasePosition()
				}
			}),
			(release) => Effect.sync(release),
		)
	})

// MARKUP

export { dismissButton, focusScopeSentinel, popoverUnderlay } from "./overlay-markup"
