import type { RpcActionName } from "./action-names"
import type { ApiScope } from "./api-scope"
import { scopesForRole } from "./role-scopes"
import type { ScopeMap } from "./scope-map"

/**
 * Checks whether a role has permission to perform an action,
 * based on the scopes declared in the scope map.
 *
 * @param scopeMap - Map of action names to required scopes
 * @param role - The user's organization role
 * @param action - The RPC/endpoint action name (e.g. "message.create")
 * @returns Object with `allowed` boolean and any `missingScopes`
 */
export const checkPermission = (
	scopeMap: ScopeMap,
	role: "owner" | "admin" | "member",
	action: RpcActionName,
): { allowed: boolean; missingScopes: ReadonlyArray<ApiScope> } => {
	const requiredScopes = scopeMap[action]
	if (requiredScopes === undefined) {
		// Action not found in scope map — deny by default
		return { allowed: false, missingScopes: [] }
	}
	if (requiredScopes.length === 0) {
		// Public endpoint — no scopes needed
		return { allowed: true, missingScopes: [] }
	}
	const grantedScopes = scopesForRole(role)
	const missing = requiredScopes.filter((scope) => !grantedScopes.has(scope))
	return { allowed: missing.length === 0, missingScopes: missing }
}

/**
 * Convenience function: returns true if the role can perform the action.
 */
export const canPerform = (
	scopeMap: ScopeMap,
	role: "owner" | "admin" | "member",
	action: RpcActionName,
): boolean => checkPermission(scopeMap, role, action).allowed
