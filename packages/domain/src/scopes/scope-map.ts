import { Context } from "effect"
import type { ApiScope } from "./api-scope"
import { RequiredScopes } from "./required-scopes"

/**
 * A map from RPC/endpoint tag names to their required scopes.
 */
export type ScopeMap = Record<string, ReadonlyArray<ApiScope>>

/**
 * Extracts a ScopeMap from an RpcGroup's `requests` map.
 *
 * Each entry in `requests` has an `annotations` field (a `Context.Context<never>`)
 * where we look up the `RequiredScopes` tag.
 */
export const scopeMapFromRpcGroup = (
	requests: ReadonlyMap<string, { readonly annotations: Context.Context<never> }>,
): ScopeMap => {
	const map: Record<string, ReadonlyArray<ApiScope>> = {}
	for (const [tag, rpc] of requests) {
		const scopes = Context.get(rpc.annotations as any, RequiredScopes) as
			| ReadonlyArray<ApiScope>
			| undefined
		if (scopes) {
			map[tag] = scopes
		}
	}
	return map
}

/**
 * Merges multiple ScopeMaps into one.
 */
export const mergeScopeMaps = (...maps: ReadonlyArray<ScopeMap>): ScopeMap => {
	const merged: Record<string, ReadonlyArray<ApiScope>> = {}
	for (const map of maps) {
		Object.assign(merged, map)
	}
	return merged
}
