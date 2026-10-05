import { UserId } from "@hazel/schema"
import { Schema } from "effect"
import { Persistable } from "effect/persistence"
import { UserLookupCacheError } from "../errors.ts"

/**
 * Schema for cached user lookup result.
 * Maps external user ID (Clerk user ID) → internal UserId.
 */
export const UserLookupResult = Schema.Struct({
	internalUserId: UserId,
})

export type UserLookupResult = typeof UserLookupResult.Type

/**
 * Request type for user lookup cache operations.
 */
export class UserLookupCacheRequest extends Persistable.Class<{
	payload: {
		/** External user ID from the identity provider (Clerk user ID). */
		externalId: string
	}
}>()("UserLookupCacheRequest", {
	primaryKey: (payload) => payload.externalId,
	success: UserLookupResult,
	error: UserLookupCacheError,
}) {}
