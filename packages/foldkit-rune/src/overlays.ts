/**
 * Overlays drawn by the host: what the app's overlay helpers (portal, isolate, anchor, dismiss)
 * ask for, by element path. The render target sends it with each element as `ov`; the host draws
 * the portal at the window's root, anchors the panel to its trigger, and makes it modal.
 */
export type OverlaySide = "top" | "bottom" | "left" | "right"
export type OverlayAlign = "start" | "center" | "end"

/** What the host draws for one element. */
export type OverlayWire = {
	/** Drawn above the page, at the window's root, rather than in place. */
	portal?: 1
	/** Placed next to the element at path `to` (its trigger), flipping and fitting in the window. */
	anchor?: {
		readonly to: string
		readonly side: OverlaySide
		readonly align: OverlayAlign
		readonly gap: number
		/** Along the trigger, as Floating UI's `crossOffset` (a context menu at the pointer). */
		readonly cross?: number
	}
	/** The page behind turns inert; a press outside or Escape dismisses the overlay at this path. */
	modal?: string
}

type Anchor = {
	readonly triggerId: string
	readonly side: OverlaySide
	readonly align: OverlayAlign
	readonly gap: number
	/** Along the trigger, as Floating UI's `crossOffset`. */
	readonly crossOffset?: number
	/** `--trigger-width` (and `--button-width`) on the panel: the trigger's width. */
	readonly isTriggerWidthSet?: boolean
}

/** React Aria placements (`bottom start`, `left`, `end top`) as a side and an alignment. */
export const parsePlacement = (placement: string): { side: OverlaySide; align: OverlayAlign } => {
	const [main = "bottom", cross] = placement.split(" ")
	const side: OverlaySide = main === "start" ? "left" : main === "end" ? "right" : (main as OverlaySide)
	const align: OverlayAlign =
		cross === undefined
			? "center"
			: cross === "start" || cross === "left" || cross === "top"
				? "start"
				: "end"
	return { side, align }
}

export const makeOverlays = () => {
	const portals = new Set<string>()
	const modals = new Set<string>()
	const anchors = new Map<string, Anchor>()
	const dismissListeners = new Map<string, Set<() => void>>()
	const changeListeners = new Set<() => void>()
	/** What the host would draw, as a string: a change is a change of this. */
	const snapshot = () =>
		JSON.stringify([
			[...portals].sort(),
			[...modals].sort(),
			[...anchors].sort(([a], [b]) => a.localeCompare(b)),
		])
	let version = 0
	let versionSnapshot = snapshot()
	let notifiedSnapshot = versionSnapshot
	let isNotifyScheduled = false
	// Released and set up again in one go (a Mount re-anchoring on every commit) is no change.
	const changed = () => {
		if (isNotifyScheduled) return
		isNotifyScheduled = true
		queueMicrotask(() => {
			isNotifyScheduled = false
			const now = snapshot()
			if (now === notifiedSnapshot) return
			notifiedSnapshot = now
			changeListeners.forEach((listener) => listener())
		})
	}

	/** Adds `path` to `set` until the returned release runs. */
	const hold = (set: Set<string>, path: string) => {
		set.add(path)
		changed()
		return () => {
			set.delete(path)
			changed()
		}
	}

	return {
		portal: (path: string) => hold(portals, path),
		modal: (path: string) => hold(modals, path),
		anchor: (path: string, anchor: Anchor) => {
			anchors.set(path, anchor)
			changed()
			return () => {
				anchors.delete(path)
				changed()
			}
		},
		anchorAt: (path: string): Anchor | undefined => anchors.get(path),
		/** Bumped when what the host draws changes: what an element's `ov` was computed against. */
		get version() {
			const now = snapshot()
			if (now !== versionSnapshot) {
				versionSnapshot = now
				version += 1
			}
			return version
		},
		/** `listener` runs when the host dismisses the modal overlay at `path`. */
		onDismiss: (path: string, listener: () => void) => {
			const listeners = dismissListeners.get(path) ?? new Set()
			listeners.add(listener)
			dismissListeners.set(path, listeners)
			return () => listeners.delete(listener)
		},
		dismissed: (path: string) => dismissListeners.get(path)?.forEach((listener) => listener()),
		/**
		 * Escape's default action, when no keydown handler prevented it: the topmost modal overlay
		 * that listens for dismissal is dismissed. Whether there was one.
		 */
		dismissTopmost: (): boolean => {
			const top = [...modals].reverse().find((path) => (dismissListeners.get(path)?.size ?? 0) > 0)
			if (top === undefined) return false
			dismissListeners.get(top)?.forEach((listener) => listener())
			return true
		},
		/** Something changed what the host must draw: the screen needs a new commit. */
		onChange: (listener: () => void) => changeListeners.add(listener),
		/**
		 * The overlay fields for the element at `path`; `pathOfId` finds a trigger by its `id`. A modal
		 * overlay is dismissed from its anchored panel when it has one, as presses outside the panel
		 * (on the underlay too) are the outside ones.
		 */
		wireFor: (path: string, pathOfId: (id: string) => string | undefined): OverlayWire | undefined => {
			// Every element asks, every commit: nothing to do while no overlay is open.
			if (portals.size === 0 && modals.size === 0 && anchors.size === 0) return undefined
			const anchor = anchors.get(path)
			const to = anchor === undefined ? undefined : pathOfId(anchor.triggerId)
			const root = [...modals].find((m) => path === m || path.startsWith(`${m}/`))
			const panelOfRoot = (m: string) => [...anchors.keys()].find((a) => a.startsWith(`${m}/`))
			const modal =
				root === undefined
					? undefined
					: path === root
						? panelOfRoot(root) === undefined
							? root
							: undefined
						: to !== undefined
							? root
							: undefined
			const wire: OverlayWire = {}
			if (portals.has(path)) wire.portal = 1
			if (anchor !== undefined && to !== undefined) {
				const placed = { to, side: anchor.side, align: anchor.align, gap: anchor.gap }
				wire.anchor =
					anchor.crossOffset === undefined || anchor.crossOffset === 0
						? placed
						: { ...placed, cross: anchor.crossOffset }
			}
			if (modal !== undefined) wire.modal = modal
			return Object.keys(wire).length === 0 ? undefined : wire
		},
	}
}

export type Overlays = ReturnType<typeof makeOverlays>
