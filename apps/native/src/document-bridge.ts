/**
 * The parts of `document` and `window` the app reads that only the render tree can answer: lookups
 * by id, its HTML render frames, elements a Mount portals into `<body>`, the theme's custom
 * properties, and clicks on links. Installed over the shims once the element bridge exists.
 */
import type { ElementBridge, StyleResolver } from "@hazel/foldkit-rune"
import { makeRootAwareMutationObserver } from "./shims"
import { nativeOverlays, pathOf } from "./overlay"

export const installDocumentBridge = (options: {
	readonly bridge: ElementBridge
	readonly styles: StyleResolver
	/** Whether the screen is drawn dark: the app's own theme on `<html>`, else the host's appearance. */
	readonly isDark: () => boolean
	/** Hears every change to `<html>`'s class or inline custom properties. */
	readonly onRootStyle: (listener: () => void) => () => void
}) => {
	const { bridge, styles } = options
	Object.assign(globalThis, {
		ResizeObserver: bridge.ResizeObserver,
		IntersectionObserver: bridge.IntersectionObserver,
		MutationObserver: makeRootAwareMutationObserver(
			bridge.MutationObserver,
			document.documentElement,
			options.onRootStyle,
		),
		// Theme tokens read through `getComputedStyle` (the HTML render theme) come from the
		// stylesheet, for the theme the screen is drawn in.
		getComputedStyle: (element?: unknown) => ({
			getPropertyValue: (name: string) =>
				name.startsWith("--") ? styles.customProperty(name, options.isDark()) : "",
			// The message toolbar looks for its message's scroller.
			overflowY: bridge.overflowYOf(element),
		}),
	})
	// SAFETY: the app only reads the geometry ProxyElement implements from `getElementById` results.
	document.getElementById = (id: string) => bridge.findById(id) as unknown as HTMLElement | null
	// The app finds its HTML render frames this way, to post the theme to them and to tell whose
	// message arrived; every other query still finds nothing.
	// SAFETY: the app reads attributes and `contentWindow` from them, which ProxyElement implements.
	document.querySelectorAll = ((selector: string) =>
		selector.startsWith("iframe")
			? bridge.queryDocument(selector)
			: []) as unknown as typeof document.querySelectorAll

	// A Mount moving its element into `<body>` (the message toolbar) portals it; `remove()` undoes it.
	const bodyPortals = new Map<string, () => void>()
	Object.assign(document.body, {
		appendChild: <T>(child: T): T => {
			const path = pathOf(child)
			if (path !== undefined && !bodyPortals.has(path))
				bodyPortals.set(path, nativeOverlays.portal(path))
			return child
		},
	})
	return {
		/** The element at `path` left the tree: a portal it had into `<body>` goes with it. */
		removed: (path: string) => {
			bodyPortals.get(path)?.()
			bodyPortals.delete(path)
		},
	}
}

/** A press on an `href` replays as the click Foldkit's link listener expects on `document`. */
export const followLink = (href: string) => {
	const link = Object.assign(new globalThis.Element(), {
		href: new URL(href, location.href).href,
		target: "",
		hasAttribute: () => false,
		closest: () => link,
	})
	const click = new Event("click", { cancelable: true })
	for (const [name, value] of Object.entries({
		target: link,
		button: 0,
		metaKey: false,
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
	})) {
		Object.defineProperty(click, name, { value })
	}
	document.dispatchEvent(click)
}

/** A Message's `_tag` chain and its innermost payload, for the debug log. */
export const messageTrail = (message: unknown) => {
	const tags: Array<string> = []
	for (let m = message; typeof m === "object" && m !== null && "_tag" in m;) {
		tags.push(String(m._tag))
		m = "message" in m ? m.message : undefined
	}
	let leaf = message
	while (typeof leaf === "object" && leaf !== null && "message" in leaf) leaf = leaf.message
	return { tags, leaf }
}
