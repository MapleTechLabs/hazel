import { MessageId } from "@hazel/schema"
import { Effect, Option, Queue, Schema, Stream } from "effect"
import { Command, Mount } from "foldkit"
import * as Render from "foldkit/render"
import { deleteMessageAction } from "~/db/actions"
import { catchCommon } from "../../../data/actions"
import { Message, type MessageKey } from "./model"

/**
 * Discord's keyboard on a focused message: the arrows move between messages, Escape goes back to the
 * composer, and E, R, T, P, Delete (Shift: no confirm), + and Mod+C act on it, as its menu would.
 * Alt+Enter (mark unread) has no server support yet.
 */

const ROW_SELECTOR = "[data-message-row]"

/** The message row a key or focus event is on itself (not a button or field inside it). */
const rowOf = (target: EventTarget | null): MessageId | null => {
	if (!(target instanceof HTMLElement) || !target.matches(ROW_SELECTOR)) return null
	return Option.getOrNull(Schema.decodeUnknownOption(MessageId)(target.dataset.id))
}

const hasTextSelection = () => {
	const selection = window.getSelection()
	return selection !== null && !selection.isCollapsed
}

/** The key's meaning on a message, or none: everything else keeps its default. */
export const messageKeyOf = (event: {
	readonly key: string
	readonly shiftKey: boolean
	readonly altKey: boolean
	readonly ctrlKey: boolean
	readonly metaKey: boolean
}): MessageKey | null => {
	const mod = event.ctrlKey || event.metaKey
	if (event.altKey) return null
	if (mod) return !event.shiftKey && event.key.toLowerCase() === "c" ? "Copy" : null
	switch (event.key) {
		case "ArrowUp":
			return "Previous"
		case "ArrowDown":
			return "Next"
		case "Escape":
			return "BackToComposer"
		case "Delete":
		case "Backspace":
			return event.shiftKey ? "DeleteNow" : "Delete"
		case "+":
		case "=":
			return "React"
	}
	if (event.shiftKey) return null
	switch (event.key.toLowerCase()) {
		case "e":
			return "Edit"
		case "r":
			return "Reply"
		case "t":
			return "Thread"
		case "p":
			return "Pin"
	}
	return null
}

type KeysMessage =
	| typeof Message.PressedMessageKey.Type
	| typeof Message.FocusedMessage.Type
	| typeof Message.StartedMessageKeys.Type

/** On the message list's container: keys pressed on a focused message, and which message has focus. */
export const TrackMessageKeys = Mount.defineStream("TrackMessageKeys", {
	messages: [Message.PressedMessageKey, Message.FocusedMessage, Message.StartedMessageKeys],
	execute: ({ element }) =>
		Stream.callback<KeysMessage>((queue) =>
			Effect.acquireRelease(
				Effect.sync(() => {
					const onKeyDown = (event: Event) => {
						const keyboard = event as KeyboardEvent
						const messageId = rowOf(keyboard.target)
						if (messageId === null || keyboard.isComposing) return
						const key = messageKeyOf(keyboard)
						// Mod+C over selected text is the browser's copy.
						if (key === null || (key === "Copy" && hasTextSelection())) return
						keyboard.preventDefault()
						Queue.offerUnsafe(queue, Message.PressedMessageKey({ messageId, key }))
					}
					const onFocusIn = (event: Event) => {
						const messageId = rowOf(event.target)
						if (messageId !== null)
							Queue.offerUnsafe(queue, Message.FocusedMessage({ messageId }))
					}
					element.addEventListener("keydown", onKeyDown)
					element.addEventListener("focusin", onFocusIn)
					Queue.offerUnsafe(queue, Message.StartedMessageKeys())
					return { onKeyDown, onFocusIn }
				}),
				({ onKeyDown, onFocusIn }) =>
					Effect.sync(() => {
						element.removeEventListener("keydown", onKeyDown)
						element.removeEventListener("focusin", onFocusIn)
					}),
			).pipe(Effect.andThen(Effect.never)),
		),
})

/** How long `FocusMessage` waits for a row scrolled in from outside the rendered window. */
const RENDER_FRAMES = 30

/**
 * Focuses a message once its row is rendered: a row the list scrolled to shows a frame or two after
 * the patch. Best-effort: a row that never shows (the window moved on) leaves the focus where it is.
 */
export const FocusMessage = Command.define("FocusMessage", {
	args: { messageId: MessageId },
	messages: [Message.CompletedFocusMessage],
	execute: ({ messageId }) =>
		Effect.gen(function* () {
			for (let frame = 0; frame < RENDER_FRAMES; frame++) {
				yield* Render.afterPaint
				const row = document.getElementById(`message-${messageId}`)
				if (row instanceof HTMLElement && row.matches(ROW_SELECTOR)) {
					row.focus({ preventScroll: true })
					return
				}
			}
		}).pipe(Effect.as(Message.CompletedFocusMessage())),
})

/** Shift+Delete: Discord's delete without the confirmation (your own messages only). */
export const DeleteMessageNow = Command.define("DeleteMessageNow", {
	args: { messageId: MessageId },
	messages: [Message.SucceededDeleteMessageNow, Message.FailedDeleteMessageNow],
	execute: ({ messageId }) =>
		deleteMessageAction({ messageId }).pipe(
			Effect.as(Message.SucceededDeleteMessageNow()),
			Effect.catchTags({
				MessageNotFoundError: () =>
					Effect.succeed(Message.FailedDeleteMessageNow({ reason: "MessageNotFound" })),
			}),
			catchCommon((reason) => Message.FailedDeleteMessageNow({ reason })),
		),
})
