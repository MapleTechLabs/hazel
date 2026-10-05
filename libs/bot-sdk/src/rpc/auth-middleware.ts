/**
 * Bot RPC Authentication Middleware
 *
 * Creates a client-side RPC middleware that injects the bot's Bearer token
 * into all RPC requests for authentication with the backend.
 */

import { Headers } from "effect/http"
import { RpcMiddleware } from "effect/rpc"
import { AuthMiddleware } from "@hazel/domain/rpc"
import { Effect } from "effect"

/**
 * Creates a client-side auth middleware that adds the bot's Bearer token
 * to all outgoing RPC requests.
 *
 * @param botToken - The bot's authentication token
 * @returns An Effect Layer that provides the AuthMiddleware client
 *
 * @example
 * ```typescript
 * const BotAuthMiddlewareLive = createBotAuthMiddleware(config.botToken)
 *
 * const RpcClientLayer = BotRpcClient.layer.pipe(
 *   Layer.provide(RpcProtocolLive),
 *   Layer.provide(BotAuthMiddlewareLive),
 * )
 * ```
 */
export const createBotAuthMiddleware = (botToken: string) =>
	RpcMiddleware.layerClient(AuthMiddleware, ({ request, next }) =>
		next({
			...request,
			headers: Headers.set(request.headers ?? Headers.empty, "authorization", `Bearer ${botToken}`),
		}),
	)
