/**
 * A linked channel's customer as the `OrgObject` holds it (`channel_customers`, projected by the
 * `CustomersObject`): what chat shows on the channel. Keyed by `channelId`.
 */
import { ChannelId, CustomerAccountId, OrganizationId } from "@hazel/schema"
import { Schema as S } from "effect"
import { JsonDate } from "./utils"

export const Schema = S.Struct({
	channelId: ChannelId,
	organizationId: OrganizationId,
	accountId: CustomerAccountId,
	accountName: S.String,
	/** Optional: rows synced or cached before logos were projected have none. */
	accountLogoUrl: S.optional(S.NullOr(S.String)),
	updatedAt: JsonDate,
})
export type Type = typeof Schema.Type
