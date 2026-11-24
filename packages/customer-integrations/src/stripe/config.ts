import { Effect, Schema } from "effect"

/**
 * Stripe: billing. Invoices always come from Stripe; subscriptions count for the accounts Autumn
 * does not bill (no Autumn subscription, or Autumn not imported yet).
 */
export const StripeConnectionConfig = Schema.TaggedStruct("stripe", {
	/** The customer metadata key holding the Clerk organization id (shared-id matching). */
	clerkOrgMetadataKey: Schema.String,
	/** Match unknown customers to accounts by their email domain. */
	matchByDomain: Schema.Boolean,
	/**
	 * The Stripe account id (`acct_…`), `""` when not given. Required with a restricted key, which may
	 * not read its own account; checked against the account a secret key opens.
	 */
	accountId: Schema.String.pipe(Schema.withDecodingDefaultKey(Effect.succeed(""))),
})
export type StripeConnectionConfig = typeof StripeConnectionConfig.Type

export const DEFAULT_STRIPE_CONFIG: StripeConnectionConfig = {
	_tag: "stripe",
	clerkOrgMetadataKey: "clerk_org_id",
	matchByDomain: true,
	accountId: "",
}
