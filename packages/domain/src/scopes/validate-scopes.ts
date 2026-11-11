import { Context } from "effect"
import { RequiredScopes } from "./required-scopes"

/**
 * Validates that all RPCs in a group have a RequiredScopes annotation.
 * Returns the list of RPC tags that are missing annotations.
 */
export const validateRpcGroupScopes = (
	requests: ReadonlyMap<string, { readonly annotations: Context.Context<never> }>,
	groupName: string,
): { valid: boolean; missing: string[] } => {
	const missing: string[] = []
	for (const [tag, rpc] of requests) {
		const scopes = Context.get(rpc.annotations as any, RequiredScopes) as
			| ReadonlyArray<string>
			| undefined
		if (!scopes) {
			missing.push(`${groupName}.${tag}`)
		}
	}
	return { valid: missing.length === 0, missing }
}
