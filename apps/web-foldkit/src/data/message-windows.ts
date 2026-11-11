import type { ChannelId } from "@hazel/schema"
import { Context, Layer, PubSub } from "effect"
import type { LiveQueryWindow } from "./live-query-changes"

/** A channel's messages window after a page moved it. */
export interface MessageWindowChange extends LiveQueryWindow {
	readonly channelId: ChannelId
}

/**
 * Pushes paging to the channel's persistent messages query: the window subscription publishes each
 * change and the query applies it with `setWindow`, so nothing polls the model per frame.
 */
export class MessageWindows extends Context.Service<MessageWindows, PubSub.PubSub<MessageWindowChange>>()(
	"MessageWindows",
) {}

export const MessageWindowsLive = Layer.effect(MessageWindows, PubSub.unbounded<MessageWindowChange>())
