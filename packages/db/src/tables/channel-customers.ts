/**
 * An `OrgObject`'s projection of its `CustomersObject`'s channel links
 * (`docs/customers/channels.md`), written only by `org.setChannelCustomers` (a full, versioned
 * snapshot). Chat shows a channel's customer from it without opening the Customers source.
 */
import { ChannelId, CustomerAccountId, OrganizationId } from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { timestamptz, uuid } from "./columns"

export const channelCustomersTable = SQLite.table("channel_customers", {
	columns: {
		channelId: uuid(ChannelId),
		organizationId: uuid(OrganizationId),
		accountId: uuid(CustomerAccountId),
		accountName: SQLite.text,
		/** The customer's logo (its account's `logoUrl`); null when it has none. */
		accountLogoUrl: SQLite.nullable(SQLite.text),
		updatedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
	},
	primaryKey: ["channelId"],
	indexes: [SQLite.index("channel_customers_account_idx", ["accountId"])],
})
export type ChannelCustomer = SQLite.SelectRowOf<typeof channelCustomersTable>
