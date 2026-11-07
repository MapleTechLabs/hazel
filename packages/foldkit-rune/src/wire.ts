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
			readonly value?: string
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

export type RuntimeToHost =
	| {
			readonly t: "tree"
			readonly ack: number
			readonly title: string
			readonly page: { readonly bg?: string; readonly color?: string }
			readonly root: WireNode
	  }
	| { readonly t: "scroll"; readonly path: string; readonly top: number }

/** Timings for one commit, for the benchmarks. */
export type CommitStats = {
	readonly viewMs: number
	readonly styleAndSerializeMs: number
	readonly bytes: number
	readonly nodes: number
	readonly reusedSubtrees: number
	readonly handlers: number
}
