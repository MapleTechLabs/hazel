import { CurrentUser, ErrorUtils, policy } from "@hazel/domain"
import type { ApiScope } from "@hazel/domain/scopes"
import { CurrentRpcScopes } from "@hazel/domain/scopes"
import { Effect } from "effect"

export type OrganizationRole = "admin" | "member" | "owner"

type PolicyActor = typeof CurrentUser.Schema.Type

/**
 * Check if an organization member role has admin privileges
 * @param role - The organization member role ("admin", "member", or "owner")
 * @returns true if role is "admin" or "owner"
 */
export const isAdminOrOwner = (role: OrganizationRole): boolean => {
	return role === "admin" || role === "owner"
}

export const makePolicy =
	<Entity extends string>(entity: Entity) =>
	<Action extends string, E, R>(
		action: Action,
		check: (actor: PolicyActor) => Effect.Effect<boolean, E, R>,
	) =>
		ErrorUtils.refailUnauthorized(entity, action)(policy(entity, action, check))

export const withPolicyUnauthorized = <A, E, R>(
	entity: string,
	action: string,
	make: Effect.Effect<A, E, R>,
) => ErrorUtils.refailUnauthorized(entity, action)(make)

/**
 * Reads the annotated scope from CurrentRpcScopes (injected by ScopeInjectionMiddleware)
 * and passes it to the given function. This bridges the RPC annotation to OrgResolver calls,
 * ensuring the enforced scope always matches the declared annotation.
 *
 * Usage:
 * ```typescript
 * withAnnotatedScope((scope) =>
 *   orgResolver.requireScope(organizationId, scope, entity, action)
 * )
 * ```
 */
export const withAnnotatedScope = <A, E, R>(
	fn: (scope: ApiScope) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | CurrentRpcScopes> =>
	Effect.gen(function* () {
		const scopes = yield* CurrentRpcScopes
		if (scopes.length === 0) {
			return yield* Effect.die(
				new Error("No RequiredScopes annotation on this RPC — cannot resolve annotated scope"),
			)
		}
		if (scopes.length > 1) {
			return yield* Effect.die(
				new Error(`withAnnotatedScope only supports single-scope RPCs; got [${scopes.join(", ")}]`),
			)
		}
		return yield* fn(scopes[0]!)
	})
