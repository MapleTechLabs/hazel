import { Option, Stream } from "effect"
import * as Dom from "foldkit/dom"

/** Document-level events the composer reacts to (`useGlobalKeyboardFocus`, `useTyping`'s blur). */

const isEditableTarget = (target: EventTarget | null) =>
	target instanceof HTMLElement &&
	(target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.contentEditable === "true")

/**
 * Printable keys typed outside inputs and editables; the key is taken over. The page runs this only
 * while none of its dialogs (or a root modal, the palette) is open, so a dialog keeps its keys.
 */
export const globalTypingStream = <Message>(toMessage: (key: string) => Message): Stream.Stream<Message> =>
	Dom.streamFromEventFilterMapPreventDefault({
		target: () => document,
		type: "keydown",
		// A key something already handled (a focused message's E, R, +) is not typing.
		filterMapEvent: (event) =>
			event.defaultPrevented ||
			isEditableTarget(event.target) ||
			event.ctrlKey ||
			event.altKey ||
			event.metaKey ||
			event.key.length !== 1
				? Option.none()
				: Option.some(toMessage(event.key)),
	})

/** The window lost focus or the document was hidden. */
export const leftWindowStream = <Message>(message: Message): Stream.Stream<Message> =>
	Stream.merge(
		Dom.streamFromEvent({ target: () => window, type: "blur", mapEvent: () => message }),
		Dom.streamFromEventFilterMap({
			target: () => document,
			type: "visibilitychange",
			filterMapEvent: () =>
				document.visibilityState === "hidden" ? Option.some(message) : Option.none(),
		}),
	)
