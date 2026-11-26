/**
 * Requests the Effect UI shell's children make of the Foldkit parts that still own their effect
 * (a channel page's overlays, the sidebar's menus, the DM modal). Part of the adapter.
 */
import type { HostRequest as MessageListRequest } from "@hazel/shared-screens/chat/messages"
import type { SidebarAction } from "@hazel/shared-screens/channel-sidebar/ChannelSidebar"
import { Effect, Queue, Stream } from "effect"
import type { ShellRequest } from "../app/message"

export type BusEvent =
	/** A menu choice in the channel sidebar, by today's keys. */
	| { readonly _tag: "ChannelSidebarAct"; readonly action: SidebarAction }
	/** What a message list row asks the channel page for (its overlays, the thread panel). */
	| { readonly _tag: "MessageList"; readonly request: MessageListRequest }
	/** A key, menu item or frame button whose work is still the Foldkit host's. */
	| { readonly _tag: "Shell"; readonly request: ShellRequest }

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
export const eventsOf = <Tag extends BusEvent["_tag"]>(tag: Tag): Stream.Stream<Extract<BusEvent, { _tag: Tag }>> =>
	events.pipe(Stream.filter((event): event is Extract<BusEvent, { _tag: Tag }> => event._tag === tag))
