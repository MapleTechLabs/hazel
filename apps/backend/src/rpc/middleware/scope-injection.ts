import { Context, Effect, Layer, Option } from "effect"
import { ScopeInjectionMiddleware } from "@hazel/domain/rpc"
import { RequiredScopes } from "@hazel/domain/scopes"
import { CurrentRpcScopes } from "@hazel/domain/scopes"

/**
 * Live implementation of scope injection middleware.
 *
 * Reads the RequiredScopes annotation from the current RPC and sets
 * the CurrentRpcScopes FiberRef for the handler via Effect.locally.
 */
export const ScopeInjectionMiddlewareLive = Layer.succeed(
	ScopeInjectionMiddleware,
	ScopeInjectionMiddleware.of((effect, { rpc }) => {
		const scopesOption = Context.getOption(rpc.annotations, RequiredScopes)
		if (Option.isNone(scopesOption)) {
			return effect
		}
		return Effect.provideService(effect, CurrentRpcScopes, scopesOption.value)
	}),
)
