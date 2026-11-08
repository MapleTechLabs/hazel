import type { OverlayWire } from "./overlays"
import type { Style } from "./style"

/** One node of the tree sent to the native host. Styles arrive resolved; no class names. */
export type WireNode =
	| { readonly k: "t"; readonly s: string }
	| {
			readonly k: "svg"
			readonly h: string
			readonly view: number
			readonly body: string
			readonly st: Style
			/** The svg's `preserveAspectRatio` when it sets one (`none`: stretch to the box). */
			readonly par?: string
	  }
	| {
			readonly k: "e"
			readonly h: string
			readonly tag: string
			readonly key?: string
			readonly st: Style
			readonly attrs: Readonly<Record<string, string>>
			readonly on: Readonly<Record<string, number>>
			readonly mount?: string
			/** The host reports this element's layout (and scroll, when it scrolls). */
			readonly o?: 1
			/** Drawn as an overlay: portalled, anchored to its trigger, modal. */
			readonly ov?: OverlayWire
			readonly c: ReadonlyArray<WireNode>
	  }
	/** A subtree the host already holds from the previous commit, by content hash. */
	| { readonly k: "r"; readonly h: string }

export type HostToRuntime =
	| {
			readonly t: "event"
			readonly seq: number
			readonly id: number
			/** For `editable` events: the element path of the DOM-backed Mount. */
			readonly path?: string
			readonly type: string
			/** The generation of the tree the event was pressed on. */
			readonly gen?: number
			readonly value?: string
			/** For a keydown: the handlers of the elements around the target, innermost first. */
			readonly chain?: ReadonlyArray<number>
			/** A click on a link: its `href`, followed unless the handler calls `preventDefault()`. */
			readonly href?: string
			readonly key?: string
			readonly shift?: boolean
			readonly meta?: boolean
			readonly ctrl?: boolean
			readonly alt?: boolean
	  }
	| { readonly t: "env"; readonly width: number; readonly height: number; readonly dark: boolean }
	| {
			readonly t: "layout"
			readonly path: string
			readonly x: number
			readonly y: number
			readonly w: number
			readonly h: number
	  }
	| { readonly t: "scrolled"; readonly path: string; readonly top: number }
	/** A key nothing focused handled: a keydown on `document`, where shortcuts listen. */
	| {
			readonly t: "key"
			readonly key: string
			readonly shift?: boolean
			readonly meta?: boolean
			readonly ctrl?: boolean
			readonly alt?: boolean
	  }
	/** A press outside a modal overlay, or Escape in it: the overlay at `path` should close. */
	| { readonly t: "dismiss"; readonly path: string }
	/**
	 * The pointer entered or left an element a pointer-tracking Mount at `mount` watches (or the
	 * Mount's own element): the bridge dispatches it there as `pointerover` / `pointerleave`.
	 */
	| { readonly t: "pointer"; readonly path: string; readonly mount: string; readonly inside: boolean }
	/** A right-click on an element a pointer-tracking Mount at `mount` watches, at window `x`, `y`. */
	| {
			readonly t: "contextmenu"
			readonly path: string
			readonly mount: string
			readonly x: number
			readonly y: number
			/** Where the elements from the Mount's down to the one clicked are: `[x, y, w, h]`. */
			readonly rects?: Readonly<Record<string, readonly [number, number, number, number]>>
	  }
	/** A link the system opened with the app (`com.hazel.native://auth/callback?...`), as given. */
	| { readonly t: "openUrl"; readonly url: string }
	/** The answer to vault request `id`: the record (`null` when none), or why the keychain failed. */
	| { readonly t: "vault"; readonly id: number; readonly record?: string | null; readonly error?: string }

export type RuntimeToHost =
	| {
			readonly t: "tree"
			readonly ack: number
			/** This tree's generation; the host stamps events with the one it drew. */
			readonly gen: number
			readonly title: string
			readonly page: { readonly bg?: string; readonly color?: string }
			readonly root: WireNode
	  }
	| { readonly t: "scroll"; readonly path: string; readonly top: number }
	/** Focus the element keyed `key` once the host has the tree it is in (`element.focus()`). */
	| { readonly t: "focus"; readonly key: string }
	/** Scroll the element at `path` into view (`element.scrollIntoView()`). */
	| { readonly t: "reveal"; readonly path: string; readonly block: "start" | "center" | "end" | "nearest" }
	/** A full page load: the host replaces this runtime with a fresh one at `path`. */
	| { readonly t: "reload"; readonly path: string }
	/** Read or replace the sign-in vault's one record in the OS keychain; answered by `vault`. */
	| { readonly t: "vault"; readonly id: number; readonly op: "read" }
	| { readonly t: "vault"; readonly id: number; readonly op: "write"; readonly record: string }

/** Timings for one commit, for the benchmarks. */
export type CommitStats = {
	readonly viewMs: number
	readonly styleAndSerializeMs: number
	readonly bytes: number
	readonly nodes: number
	readonly reusedSubtrees: number
	readonly handlers: number
}
