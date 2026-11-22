import { Schema } from "effect"

/** Clerk: users' sign-ins and sessions drive activity. */
export const ClerkConnectionConfig = Schema.TaggedStruct("clerk", {
	/** Create accounts for Clerk organizations with no match (Clerk is the identity source). */
	createAccounts: Schema.Boolean,
})
export type ClerkConnectionConfig = typeof ClerkConnectionConfig.Type

export const DEFAULT_CLERK_CONFIG: ClerkConnectionConfig = { _tag: "clerk", createAccounts: true }
