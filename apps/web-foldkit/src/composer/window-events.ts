import { Option, Stream } from "effect"
import * as Dom from "foldkit/dom"
import { clipboardFiles } from "../editor/file-types"

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

/** What a paste outside inputs and editables carries for the composer: files, else text. */
export type GlobalPaste =
	| { readonly _tag: "Files"; readonly files: ReadonlyArray<File> }
	| { readonly _tag: "Text"; readonly text: string }

/**
 * Pastes made outside inputs and editables go to the composer, as typing does: files attach, text
 * is pasted into the editor. Runs under the same conditions as `globalTypingStream`.
 */
export const globalPasteStream = <Message>(
	toMessage: (paste: GlobalPaste) => Message,
): Stream.Stream<Message> =>
	Dom.streamFromEventFilterMapPreventDefault({
		target: () => document,
		type: "paste",
		filterMapEvent: (event) => {
			const data = event.clipboardData
			if (event.defaultPrevented || isEditableTarget(event.target) || data === null)
				return Option.none()
			const files = clipboardFiles(data)
			if (files.length > 0) return Option.some(toMessage({ _tag: "Files", files }))
			const text = data.getData("text/plain")
			return text === "" ? Option.none() : Option.some(toMessage({ _tag: "Text", text }))
		},
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
