/**
 * Bot RPC Client Service
 *
 * Provides HTTP-based RPC client for bots to interact with the Hazel backend.
 * Uses FetchHttpClient for HTTP transport and NDJSON serialization.
 */

import { FetchHttpClient } from "effect/http"
import { RpcClient, RpcSerialization } from "effect/rpc"
import { ChannelRpcs, MessageReactionRpcs, MessageRpcs, TypingIndicatorRpcs } from "@hazel/domain/rpc"
import { Effect, Layer, Context } from "effect"
import { createBotAuthMiddleware } from "./auth-middleware.ts"

/**
 * Merged RPC groups that bots can use
 * Includes: Messages, Channels, Reactions, Typing indicators
 */
export const BotRpcs = MessageRpcs.merge(ChannelRpcs, MessageReactionRpcs, TypingIndicatorRpcs)

/**
 * Configuration for creating the bot RPC client
 */
export interface BotRpcClientConfig {
	/**
	 * Backend URL for HTTP RPC connection
	 * @example "https://api.hazel.sh" or "http://localhost:3003"
	 */
	readonly backendUrl: string

	/**
	 * Bot authentication token
	 */
	readonly botToken: string
}

/**
 * Internal context tag for the RPC client configuration
 */
export class BotRpcClientConfigTag extends Context.Service<BotRpcClientConfigTag, BotRpcClientConfig>()(
	"@hazel/bot-sdk/BotRpcClientConfig",
) {}

/**
 * Context tag for the RPC client instance
 * Type is inferred from the actual RpcClient.make result
 */
export class BotRpcClient extends Context.Service<
	BotRpcClient,
	Effect.Success<ReturnType<typeof makeBotRpcClient>>
>()("@hazel/bot-sdk/BotRpcClient") {}

/**
 * Create a scoped layer that provides the RPC client
 */
export const BotRpcClientLive = Layer.effect(
	BotRpcClient,
	Effect.gen(function* () {
		const config = yield* BotRpcClientConfigTag
		return yield* makeBotRpcClient(config)
	}),
)

/**
 * Creates an Effect that yields the RPC client for bot operations
 * Types are inferred naturally from RpcClient.make
 *
 * @param config - Client configuration (backendUrl, botToken)
 * @returns Effect that creates the RPC client
 */
export const makeBotRpcClient = Effect.fn("BotRpcClient.makeBotRpcClient")(function* (
	config: BotRpcClientConfig,
) {
	// Use HTTP endpoint for bots (simpler, more reliable than WebSocket)
	const rpcUrl = `${config.backendUrl}/rpc`

	// Create HTTP protocol layer
	const ProtocolLayer = RpcClient.layerProtocolHttp({
		url: rpcUrl,
	}).pipe(Layer.provide(Layer.mergeAll(FetchHttpClient.layer, RpcSerialization.layerNdjson)))

	// Auth middleware adds Bearer token to each request
	const AuthMiddlewareLayer = createBotAuthMiddleware(config.botToken)

	// Provide both protocol and auth middleware to the RPC client
	return yield* RpcClient.make(BotRpcs).pipe(
		Effect.provide(Layer.mergeAll(ProtocolLayer, AuthMiddlewareLayer)),
	)
})
