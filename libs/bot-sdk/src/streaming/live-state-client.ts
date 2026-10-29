/**
 * LiveStateClient: a streamed message's live state, written over the Hazel API
 * (`POST /api/v1/messages/:id/live`, the bot token as bearer). The message's `MessageLiveObject`
 * streams each write to the channel's viewers and, on complete or fail, saves the final snapshot
 * into the message.
 */
import { GetLiveStateQuery, HazelApi, WriteLiveStateRequest } from "@hazel/domain/http"
import type { LiveAction, LiveState, LiveWriteResult } from "@hazel/domain/live"
import type { ChannelId, MessageId } from "@hazel/schema"
import { Context, Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import { ActorOperationError } from "./errors.ts"

export interface LiveStateClientService {
	/** Apply one action to `messageId`'s live state; only the message's author (this bot) may. */
	readonly write: (
		messageId: MessageId,
		channelId: ChannelId,
		action: LiveAction,
	) => Effect.Effect<LiveWriteResult, ActorOperationError>
	/** The live state as it stands. */
	readonly getState: (
		messageId: MessageId,
		channelId: ChannelId,
	) => Effect.Effect<LiveState, ActorOperationError>
}

export interface LiveStateClientConfig {
	/** The Hazel API (`https://api.hazel.sh`). */
	readonly backendUrl: string
	/** The bot token (`hzl_bot_…`). */
	readonly botToken: string
}

type MessagesApi = HttpApiClient.ForApi<typeof HazelApi>["api-v1-messages"]

/** The service over an `api-v1-messages` client (the bot client already holds one). */
export const makeLiveStateClient = (messages: MessagesApi): LiveStateClientService => ({
	write: (messageId, channelId, action) =>
		messages
			.writeLiveState({
				params: { id: messageId },
				payload: new WriteLiveStateRequest({ channelId, action }),
			})
			.pipe(
				Effect.map((response) => response.data),
				Effect.mapError(
					(cause) =>
						new ActorOperationError({
							operation: action._tag,
							message: `Live state operation failed: ${action._tag}`,
							cause,
						}),
				),
				Effect.withSpan("LiveStateClient.write", {
					attributes: { "message.id": messageId, "live.action": action._tag },
				}),
			),
	getState: (messageId, channelId) =>
		messages
			.getLiveState({
				params: { id: messageId },
				query: new GetLiveStateQuery({ channel_id: channelId }),
			})
			.pipe(
				Effect.map((response) => response.data),
				Effect.mapError(
					(cause) =>
						new ActorOperationError({
							operation: "getState",
							message: "Live state operation failed: getState",
							cause,
						}),
				),
				Effect.withSpan("LiveStateClient.getState", { attributes: { "message.id": messageId } }),
			),
})

/**
 * @example
 * ```typescript
 * const layer = LiveStateClient.layer({ backendUrl: "https://api.hazel.sh", botToken })
 * const program = Effect.gen(function* () {
 *   const live = yield* LiveStateClient
 *   yield* live.write(messageId, channelId, { _tag: "AppendText", text: "Hello" })
 * }).pipe(Effect.provide(layer))
 * ```
 */
export class LiveStateClient extends Context.Service<LiveStateClient, LiveStateClientService>()(
	"@hazel/bot-sdk/LiveStateClient",
) {
	static readonly layer = (config: LiveStateClientConfig) =>
		Layer.effect(
			this,
			HttpApiClient.make(HazelApi, { baseUrl: config.backendUrl }).pipe(
				Effect.map((client) => makeLiveStateClient(client["api-v1-messages"])),
				Effect.provide(
					FetchHttpClient.layer.pipe(
						Layer.provide(
							Layer.succeed(FetchHttpClient.RequestInit, {
								headers: { Authorization: `Bearer ${config.botToken}` },
							}),
						),
					),
				),
			),
		)
}
