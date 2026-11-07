/**
 * The native `anchorSetup` for `@foldkit/ui`'s anchor module (swapped in by `overlay-plugin.ts`):
 * where the browser positions a panel with Floating UI, the host anchors it to its trigger with
 * Rune's own flip and fit, drawn at the window's root unless the config says otherwise.
 */
import type { OverlayAlign, OverlaySide } from "@hazel/foldkit-rune"

import { nativeOverlays, pathOf } from "./overlay"

type AnchorSetupConfig = {
	readonly buttonId: string
	readonly anchor: { readonly placement?: string; readonly gap?: number; readonly portal?: boolean }
}

/** Floating UI's placements (`bottom`, `top-start`, `right-end`) as a side and an alignment. */
export const floatingPlacement = (placement: string): { side: OverlaySide; align: OverlayAlign } => {
	const [main = "bottom", cross] = placement.split("-")
	const side: OverlaySide = main === "top" || main === "left" || main === "right" ? main : "bottom"
	const align: OverlayAlign = cross === "start" ? "start" : cross === "end" ? "end" : "center"
	return { side, align }
}

export const anchorSetup = (element: unknown, config: AnchorSetupConfig): (() => void) => {
	const path = pathOf(element)
	if (path === undefined) return () => undefined
	const releasePortal = config.anchor.portal === false ? () => undefined : nativeOverlays.portal(path)
	const releaseAnchor = nativeOverlays.anchor(path, {
		triggerId: config.buttonId,
		...floatingPlacement(config.anchor.placement ?? "bottom"),
		gap: config.anchor.gap ?? 0,
	})
	return () => {
		releaseAnchor()
		releasePortal()
	}
}

/** A backdrop (or any element) moved to the page's portal root: the host draws it at the window's. */
export const portalToContainingRoot = (element: unknown): (() => void) => {
	const path = pathOf(element)
	return path === undefined ? () => undefined : nativeOverlays.portal(path)
}

export const portalBackdrop = portalToContainingRoot
