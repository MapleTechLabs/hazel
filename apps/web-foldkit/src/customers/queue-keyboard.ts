/**
 * The web's `QueueKeyboard` (`@hazel/shared-screens/customers/queue/keys`): one document listener per
 * page, filtered by `ui/queue-keys.ts` (typing, a modifier, a dialog or open menu, the assistant
 * panel, Enter or Space on a focused control); a key an element already took is skipped.
 */
import { QueueKeyboard } from "@hazel/shared-screens/customers/queue/keys"
import { Effect, Layer, Queue, Stream } from "effect"
import { queueKeyFilter } from "./ui/queue-keys"

export const QueueKeyboardWeb = Layer.succeed(
	QueueKeyboard,
	QueueKeyboard.of({
		listen: (table) => {
			const keyOf = queueKeyFilter(table.keys, table.repeatable, table.pressable)
			return Stream.callback((queue) =>
				Effect.acquireRelease(
					Effect.sync(() => {
						const onKeyDown = (event: KeyboardEvent) => {
							if (event.defaultPrevented) return
							const key = keyOf(event)
							if (key === null) return
							event.preventDefault()
							Queue.offerUnsafe(queue, key)
						}
						document.addEventListener("keydown", onKeyDown)
						return onKeyDown
					}),
					(onKeyDown) => Effect.sync(() => document.removeEventListener("keydown", onKeyDown)),
				).pipe(Effect.flatMap(() => Effect.never)),
			)
		},
	}),
)
