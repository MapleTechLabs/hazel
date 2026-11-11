import { Schema } from "effect"

/** The subject of a Clerk-issued OAuth access token (Maple's integration, the last Clerk consumer). */
export const ClerkUserId = Schema.Trimmed.check(Schema.isNonEmpty())
	.pipe(Schema.brand("@HazelChat/ClerkUserId"))
	.annotate({
		description: "A Clerk user identifier (user_…)",
		title: "Clerk User ID",
	})
export type ClerkUserId = Schema.Schema.Type<typeof ClerkUserId>
