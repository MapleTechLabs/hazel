/**
 * Requests the Effect UI shell's children make of the Foldkit parts that still own their effect
 * (a channel page's overlays, the DM modal), and native pages' requests of the
 * shell. Part of the adapter.
 */
import type { AppRequest } from "@hazel/shared-screens/app/requests"
import type { HostRequest as MessageListRequest } from "@hazel/shared-screens/chat/messages"
import type { MessageId } from "@hazel/schema"
import { Effect, Queue, Stream } from "effect"
import type { ShellRequest } from "../app/message"
import type { ListHoleEvent } from "../page/customers/list/hole"

export type BusEvent =
	/** What a message list row asks the channel page for (its overlays, the thread panel). */
	| { readonly _tag: "MessageList"; readonly request: MessageListRequest }
	/** A key, menu item or frame button whose work is still the Foldkit host's. */
	| { readonly _tag: "Shell"; readonly request: ShellRequest }
	/** A pin pressed in the channel header: the channel page scrolls to its message. */
	| { readonly _tag: "JumpToPin"; readonly messageId: MessageId }
	/** The channel page's pins shortcut, which the channel header's pins answer. */
	| { readonly _tag: "PinsHotkey" }
	/** What a native page asks the app for (`shared-screens/src/app/requests.ts`); the shell acts on it. */
	| { readonly _tag: "AppRequest"; readonly request: AppRequest }
	/** What the customers list's hazel controls and table ask the Foldkit list page for. */
	| { readonly _tag: "CustomersList"; readonly event: ListHoleEvent }

const listeners = new Set<(event: BusEvent) => void>()

export const publish = (event: BusEvent): void => {
	for (const listener of listeners) listener(event)
}

/** Every event published while the stream runs. */
export const events: Stream.Stream<BusEvent> = Stream.callback<BusEvent>((queue) =>
	Effect.acquireRelease(
		Effect.sync(() => {
			const listener = (event: BusEvent) => Queue.offerUnsafe(queue, event)
			listeners.add(listener)
			return listener
		}),
		(listener) => Effect.sync(() => listeners.delete(listener)),
	),
)

/** The events of one kind, as their payloads. */
export const eventsOf = <Tag extends BusEvent["_tag"]>(
	tag: Tag,
): Stream.Stream<Extract<BusEvent, { _tag: Tag }>> =>
	events.pipe(Stream.filter((event): event is Extract<BusEvent, { _tag: Tag }> => event._tag === tag))
