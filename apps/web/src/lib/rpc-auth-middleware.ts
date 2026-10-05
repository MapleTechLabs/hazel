/**
 * Client-side RPC auth middleware — attaches the Clerk session token as a
 * Bearer header on outbound RPC requests.
 */
import { Headers } from "effect/http"
import { RpcMiddleware } from "effect/rpc"
import { AuthMiddleware } from "@hazel/domain/rpc"
import { Effect } from "effect"
import { getClerkToken } from "~/lib/clerk-token"

export const AuthMiddlewareClientLive = RpcMiddleware.layerClient(AuthMiddleware, ({ request, next }) =>
	Effect.gen(function* () {
		const token = yield* Effect.promise(() => getClerkToken())
		if (token) {
			const newHeaders = Headers.set(request.headers, "authorization", `Bearer ${token}`)
			return yield* next({ ...request, headers: newHeaders })
		}
		return yield* next(request)
	}),
)
