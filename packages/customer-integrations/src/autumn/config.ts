import { Schema } from "effect"

/**
 * Autumn: products → subscriptions (the MRR source of the accounts it bills, once imported), feature
 * usage and limits → metrics.
 */
export const AutumnConnectionConfig = Schema.TaggedStruct("autumn", {
	/** Autumn customer id = Clerk organization id. */
	customerIdIsClerkOrgId: Schema.Boolean,
})
export type AutumnConnectionConfig = typeof AutumnConnectionConfig.Type

export const DEFAULT_AUTUMN_CONFIG: AutumnConnectionConfig = {
	_tag: "autumn",
	customerIdIsClerkOrgId: true,
}
