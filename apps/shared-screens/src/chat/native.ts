// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The message list on a native host (the iOS spike's `-HazelScreen channel[:<name>]`): waits for the
 * named channel (else the first public one) to sync, then mounts. The spike has no composer, router
 * or thread panel: a row's request is logged.
 */
import { Renderer } from "@effect/ui"
import { ClientData, HazelRpc } from "@hazel/client-data"
import type { ChannelId, UserId } from "@hazel/schema"
import { Effect, Option, Stream } from "effect"
import { messageListLayer } from "./live"
import { noLiveConnection } from "./rich/live-replies"
import { MessageList } from "./MessageList"

interface ChannelRow {
	readonly id: ChannelId
	readonly name: string
	readonly type: string
}

/** Mounts the list of the channel named `name` in `container`; runs until its scope closes. */
export const mountMessageListNative = (
	container: Parameters<typeof Renderer.mount>[2],
	userId: UserId,
	name: string,
	cdnUrl: string,
) =>
	Effect.gen(function* () {
		const data = yield* ClientData
		const rpc = yield* HazelRpc
		const channel = yield* data
			.liveQueryStream<ChannelRow, ChannelRow | undefined>(
				(q) => q.from({ channel: data.collections.channelCollection }),
				(rows) =>
					rows.find((row) => row.name === name) ??
					(name === "" ? rows.find((row) => row.type === "public") : undefined),
			)
			.pipe(
				Stream.filter((row): row is ChannelRow => row !== undefined),
				Stream.runHead,
			)
		if (Option.isNone(channel)) return yield* Effect.never
		console.log(`[channel] mounting #${channel.value.name}`)
		return yield* Renderer.mount(
			MessageList,
			{
				channelId: channel.value.id,
				userId,
				cdnUrl,
				linkPreviewUrl: "https://link-preview.hazel.sh",
				nowMs: Date.now(),
			},
			container,
		).pipe(
			Effect.provide(
				messageListLayer(
					data,
					rpc,
					(request) => console.log(`[channel] request ${JSON.stringify(request)}`),
					noLiveConnection,
				),
			),
		)
	})
