import { RpcMiddleware } from "effect/rpc"

/**
 * Middleware that reads RequiredScopes from the RPC annotation
 * and sets CurrentRpcScopes FiberRef for the handler.
 *
 * Uses `wrap: true` so it wraps the handler with Effect.locally
 * to set the FiberRef value.
 */
export class ScopeInjectionMiddleware extends RpcMiddleware.Service<ScopeInjectionMiddleware>()(
	"ScopeInjectionMiddleware",
) {}
