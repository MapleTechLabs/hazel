/**
 * `<iframe>`s (HTML renders): the host shows each one's page in a web view over its box, and
 * reports the frame's `load` and what its page posts to its parent. Here those become what the
 * web app listens for: the element's `load` handler, and a `message` event on `window` whose
 * `source` is the frame's `contentWindow`.
 */
import type { HostToRuntime } from "@hazel/foldkit-rune"

type FrameMessage = Extract<HostToRuntime, { t: "frame" }>

/** A frame's element, as the bridge's proxy gives it. */
type FrameElement = { readonly contentWindow: object | null }

export type FrameEventsOptions = {
	/** The frame element at a path, while the tree has it. */
	readonly frameAt: (path: string) => FrameElement | null
	/** Runs the element at `path`'s own handler for `event` (`h.OnLoad`). */
	readonly fire: (path: string, event: Event) => void
	/** `window`, where the app listens for `message`. */
	readonly window: Pick<EventTarget, "dispatchEvent">
	/** `document` and `navigator`: the app reads the focused frame and the reader's activation from them. */
	readonly document: { activeElement: unknown }
	readonly navigator: { userActivation?: { readonly isActive: boolean } }
}

/** Handles a host `frame` message: the element's `load` handler, or a `message` event on `window`. */
export const makeFrameEvents = (options: FrameEventsOptions) => (message: FrameMessage) => {
	if (message.event === "load") {
		options.fire(message.path, new Event("load"))
		return
	}
	const frame = options.frameAt(message.path)
	// A page can post after its frame left the tree: nothing listens for it any more.
	if (frame === null || frame.contentWindow === null) return
	const event = Object.assign(new Event("message"), { source: frame.contentWindow, data: message.data })
	// Listeners run inside `dispatchEvent`: for its length the document reads as the web view's
	// page did when the message was posted (which frame has focus, whether the reader just acted).
	const { document, navigator } = options
	const before = { activeElement: document.activeElement, userActivation: navigator.userActivation }
	document.activeElement = message.active ? frame : null
	navigator.userActivation = { isActive: message.active }
	try {
		options.window.dispatchEvent(event)
	} finally {
		document.activeElement = before.activeElement
		navigator.userActivation = before.userActivation
	}
}
