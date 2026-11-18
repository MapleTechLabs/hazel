import { Effect, Option, Queue, Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import { comboOfPress, heldModifiers, MODIFIER_ORDER, Platform } from "~/lib/keybindings/key-combo"
import type { PageSubscriptionInput } from "../../contract"
import { Message } from "./message"
import type { Model } from "./model"

/** The element a click inside keeps the recording going (the row's key button). */
export const RECORDER_ATTRIBUTE = "data-keybind-recorder"

const modifiersOf = (event: KeyboardEvent, platform: Platform) => {
	const held = heldModifiers(event, platform)
	return MODIFIER_ORDER.filter((modifier) => held.has(modifier))
}

/**
 * While recording, every key press is the recording's: caught on the window before anything else
 * (the app's own hotkeys, the browser's), so ⌘K records ⌘K instead of opening the palette. Escape
 * alone cancels; a click elsewhere or leaving the window does too.
 */
export const recorderStream = (platform: Platform) =>
	Stream.callback<Message>((queue) =>
		Effect.acquireRelease(
			Effect.sync(() => {
				const onKeyDown = (event: KeyboardEvent) => {
					event.preventDefault()
					event.stopImmediatePropagation()
					if (event.isComposing || event.repeat) return
					const noModifiers = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
					if (event.key === "Escape" && noModifiers)
						return Queue.offerUnsafe(queue, Message.CancelledRecording())
					Option.match(comboOfPress(event, platform), {
						onNone: () =>
							Queue.offerUnsafe(
								queue,
								Message.ChangedHeldModifiers({ modifiers: modifiersOf(event, platform) }),
							),
						onSome: (combo) => Queue.offerUnsafe(queue, Message.PressedCombo({ combo })),
					})
				}
				const onKeyUp = (event: KeyboardEvent) => {
					event.preventDefault()
					event.stopImmediatePropagation()
					Queue.offerUnsafe(
						queue,
						Message.ChangedHeldModifiers({ modifiers: modifiersOf(event, platform) }),
					)
				}
				const onPointerDown = (event: PointerEvent) => {
					const inside =
						event.target instanceof Element && event.target.closest(`[${RECORDER_ATTRIBUTE}]`)
					if (!inside) Queue.offerUnsafe(queue, Message.CancelledRecording())
				}
				const onBlur = () => Queue.offerUnsafe(queue, Message.CancelledRecording())
				window.addEventListener("keydown", onKeyDown, true)
				window.addEventListener("keyup", onKeyUp, true)
				window.addEventListener("pointerdown", onPointerDown, true)
				window.addEventListener("blur", onBlur)
				return () => {
					window.removeEventListener("keydown", onKeyDown, true)
					window.removeEventListener("keyup", onKeyUp, true)
					window.removeEventListener("pointerdown", onPointerDown, true)
					window.removeEventListener("blur", onBlur)
				}
			}),
			(release) => Effect.sync(release),
		).pipe(Effect.flatMap(() => Effect.never)),
	)

export const subscriptions = Subscription.make<PageSubscriptionInput<Model>, Message>()((entry) => ({
	recorder: entry(
		{ isRecording: Schema.Boolean, platform: Platform },
		{
			modelToDependencies: ({ model, shared }) => ({
				isRecording: model.recording !== null,
				platform: shared.keyboardPlatform,
			}),
			dependenciesToStream: ({ isRecording, platform }) =>
				isRecording ? recorderStream(platform) : Stream.empty,
		},
	),
}))
