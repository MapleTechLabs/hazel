import { Context } from "effect"
import type { ApiScope } from "./api-scope"

/**
 * Service holding the required scopes for the currently executing RPC.
 *
 * Populated by the ScopeInjectionMiddleware from the
 * RPC's RequiredScopes annotation. Policy utilities read from this instead
 * of accepting hardcoded scope strings, ensuring annotation and enforcement
 * always match.
 *
 * Provided per request, so services that check scopes require it in their methods on purpose.
 *
 * @effect-leakable-service
 */
export class CurrentRpcScopes extends Context.Service<CurrentRpcScopes, ReadonlyArray<ApiScope>>()(
	"CurrentRpcScopes",
) {}
