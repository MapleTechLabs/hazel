/**
 * The native stand-in for the web app's `ui/aria/overlay.ts` (swapped in by `overlay-plugin.ts`):
 * the same helpers, asking the Rune host for what the browser builds from DOM. The host draws the
 * portal at the window's root, anchors the panel to its trigger (flipping and fitting), makes it
 * modal (the page inert, focus trapped, Escape and outside presses dismiss), and hands focus back.
 */
import { makeOverlays, parsePlacement } from "@hazel/foldkit-rune"
import { Effect, type Scope } from "effect"

import type { PositionConfig } from "../../web-foldkit/src/ui/aria/overlay"

export {
	dismissButton,
	focusScopeSentinel,
	popoverUnderlay,
} from "../../web-foldkit/src/ui/aria/overlay-markup"
export type { PositionConfig } from "../../web-foldkit/src/ui/aria/overlay"

/** What the app's overlays ask of the host; the render target sends it and routes dismissals. */
export const nativeOverlays = makeOverlays()

const nothing = () => undefined

/** The path of an element proxy (the bridge's); a non-proxy has none and gets nothing. */
export const pathOf = (element: unknown): string | undefined => {
	if (typeof element !== "object" || element === null || !("__path" in element)) return undefined
	const path = element.__path
	return typeof path === "string" ? path : undefined
}

const anchorPath = (path: string, config: PositionConfig): (() => void) =>
	nativeOverlays.anchor(path, {
		triggerId: config.triggerId,
		...parsePlacement(config.placement),
		gap: config.offset,
		isTriggerWidthSet: config.isTriggerWidthSet === true,
	})

export const positionOverlay = (overlay: unknown, config: PositionConfig): (() => void) => {
	const path = pathOf(overlay)
	return path === undefined ? nothing : anchorPath(path, config)
}

export const portalOverlay = (element: unknown): (() => void) => {
	const path = pathOf(element)
	return path === undefined ? nothing : nativeOverlays.portal(path)
}

export const isolateOverlay = (root: unknown, _key: string): Effect.Effect<void, never, Scope.Scope> => {
	const path = pathOf(root)
	if (path === undefined) return Effect.void
	return Effect.acquireRelease(
		Effect.sync(() => nativeOverlays.modal(path)),
		(release) => Effect.sync(release),
	).pipe(Effect.asVoid)
}

/** Rune's modal hides the page behind it from assistive technology. */
export const ariaHideOutside = (_visible: ReadonlyArray<unknown>): (() => void) => nothing

/** The host reports a press outside the modal overlay (or Escape in it) as a dismissal of `root`. */
export const watchInteractOutside = (
	root: unknown,
	_insideSelector: string,
	onInteractOutside: () => void,
): (() => void) => {
	const path = pathOf(root)
	if (path === undefined) return nothing
	const stop = nativeOverlays.onDismiss(path, onInteractOutside)
	return () => {
		stop()
	}
}

/** Rune gives focus back to the element that had it when a modal overlay goes away. */
export const restoreFocusTo = (_triggerId: string, _overlay: unknown): (() => void) => nothing

export const restoreFocusToPrevious = (_overlay: unknown): (() => void) => nothing

/** Rune's modal keeps Tab inside it. */
export const containFocus = (_root: unknown): (() => void) => nothing

export const openModalPopover = (
	root: unknown,
	config: PositionConfig &
		Readonly<{ initialFocusId: string; insideSelector: string; onInteractOutside: () => void }>,
): Effect.Effect<void, never, Scope.Scope> => {
	const path = pathOf(root)
	if (path === undefined) return Effect.void
	return Effect.gen(function* () {
		yield* Effect.acquireRelease(
			Effect.sync(() => portalOverlay(root)),
			(release) => Effect.sync(release),
		)
		yield* isolateOverlay(root, config.insideSelector)
		const panel = pathOf(querySelector(root, "[data-popover]"))
		yield* Effect.acquireRelease(
			Effect.sync(() => {
				const releasePosition = panel === undefined ? nothing : anchorPath(panel, config)
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
}

/** The proxy `root.querySelector(selector)` answers, as the object `pathOf` reads. */
const querySelector = (root: unknown, selector: string): object | undefined => {
	if (typeof root !== "object" || root === null || !("querySelector" in root)) return undefined
	const query = root.querySelector
	if (typeof query !== "function") return undefined
	const found: unknown = query.call(root, selector)
	return typeof found === "object" && found !== null ? found : undefined
}
