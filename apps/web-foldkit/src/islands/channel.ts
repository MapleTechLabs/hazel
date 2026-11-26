// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The shared `hazel` message list as an island in the channel page, behind the
 * `hazel:island:channel` localStorage flag. Foldkit renders an empty container in place of today's
 * list; this Mount runs the screen there on the web host, over the app's one ClientData.
 */
import { Renderer } from "@effect/ui"
import { HazelRpc } from "@hazel/client-data"
import { MessageList } from "@hazel/shared-screens/chat/MessageList"
import { messageListLayer } from "@hazel/shared-screens/chat/live"
import type { HostRequest } from "@hazel/shared-screens/chat/messages"
import { withWebHost } from "@hazel/ui/web/mount"
import type { ChannelId, UserId } from "@hazel/schema"
import { Context, Effect, Layer, Queue, Stream } from "effect"
import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import { currentServer } from "~/config/server"
import { clientData } from "~/db/client"
import { HazelRpcLive } from "../rpc"
import "./styles"

export const CHANNEL_FLAG = "hazel:island:channel"

/** Read once at load: flipping the flag takes a reload, so today's list never changes under it. */
export const isChannelIslandEnabled: boolean = (() => {
	try {
		return globalThis.localStorage?.getItem(CHANNEL_FLAG) === "1"
	} catch {
		return false
	}
})()

interface Args {
	readonly channelId: ChannelId
	readonly userId: UserId
}

const mountIsland = (element: Element, args: Args, handle: (request: HostRequest) => void) =>
	Effect.gen(function* () {
		// Built in the Mount's scope: a provided Layer would close the client when this effect returns.
		const rpc = Context.get(yield* Layer.build(HazelRpcLive), HazelRpc)
		const mounting = Renderer.mount(
			MessageList,
			{ ...args, cdnUrl: currentServer().cdn ?? "https://cdn.hazel.sh", nowMs: Date.now() },
			element,
			{ head: false },
		).pipe(Effect.provide(messageListLayer(clientData, rpc, handle)))
		// Built in the Mount's scope: the element's removal closes it, which unmounts the tree.
		yield* Layer.build(withWebHost(mounting))
	})

/** Runs the island in `element` while the stream runs; emits what its rows ask the page for. */
export const channelIsland = (element: Element, args: Args): Stream.Stream<HostRequest> =>
	Stream.callback<HostRequest>((queue) =>
		mountIsland(element, args, (request) => Queue.offerUnsafe(queue, request)).pipe(
			Effect.flatMap(() => Effect.never),
		),
	)

/** The island's container, in the list's place: keyed by channel, so a switch mounts a fresh list. */
export const channelIslandView = <ParentMessage>(
	h: HtmlBuilder<ParentMessage>,
	options: {
		readonly channelId: ChannelId
		/** The page's `OnMount` running `channelIsland` for this channel. */
		readonly onMount: Attribute<ParentMessage>
	},
): Html =>
	h.keyed("div")(`hazel-island:channel:${options.channelId}`, [
		h.Attribute("data-island", "channel"),
		// The screen's root fills the island, so its list scrolls inside it.
		h.Class("flex min-h-0 flex-1 flex-col [&>[data-hz]]:min-h-0 [&>[data-hz]]:flex-1"),
		options.onMount,
	])
