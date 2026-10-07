import { Effect, Queue, Stream } from "effect"

/** Document-level listeners the composer reacts to (`useGlobalKeyboardFocus`, `useTyping`'s blur). */

/** Printable keys typed outside inputs, editables and open dialogs; the key is taken over. */
export const globalTypingStream = <Message>(toMessage: (key: string) => Message): Stream.Stream<Message> =>
	Stream.callback<Message>((queue) =>
		Effect.acquireRelease(
			Effect.sync(() => {
				const onKeyDown = (event: KeyboardEvent) => {
					const target = event.target
					if (
						target instanceof HTMLElement &&
						(target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.contentEditable === "true")
					)
						return
					if (document.querySelector('[role="dialog"]:not([data-react-aria-hidden="true"] *)')) return
					if (event.ctrlKey || event.altKey || event.metaKey) return
					if (event.key.length !== 1) return
					event.preventDefault()
					Queue.offerUnsafe(queue, toMessage(event.key))
				}
				document.addEventListener("keydown", onKeyDown)
				return () => document.removeEventListener("keydown", onKeyDown)
			}),
			(release) => Effect.sync(release),
		).pipe(Effect.flatMap(() => Effect.never)),
	)

/** The window lost focus or the document was hidden. */
export const leftWindowStream = <Message>(message: Message): Stream.Stream<Message> =>
	Stream.callback<Message>((queue) =>
		Effect.acquireRelease(
			Effect.sync(() => {
				const onBlur = () => Queue.offerUnsafe(queue, message)
				const onVisibility = () => {
					if (document.visibilityState === "hidden") Queue.offerUnsafe(queue, message)
				}
				window.addEventListener("blur", onBlur)
				document.addEventListener("visibilitychange", onVisibility)
				return () => {
					window.removeEventListener("blur", onBlur)
					document.removeEventListener("visibilitychange", onVisibility)
				}
			}),
			(release) => Effect.sync(release),
		).pipe(Effect.flatMap(() => Effect.never)),
	)
