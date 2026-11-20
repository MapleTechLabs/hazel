/**
 * An `OrgObject`'s projection of its `CustomersObject`'s channel links
 * (`docs/customers/channels.md`), written only by `org.setChannelCustomers` (a full, versioned
 * snapshot). Chat shows a channel's customer from it without opening the Customers source: the
 * name, and the account at a glance (health, stage, plan, MRR, owner, seats, last active day, open
 * signals, provider links).
 *
 * The glance columns came after the table (objects migrate lazily, old snapshots lack them): all
 * nullable or defaulted.
 */
import { HealthStatus, LifecycleStage } from "@hazel/domain/customers"
import type { ChannelCustomer as ChannelCustomerModel } from "@hazel/domain/models"
import { ChannelId, CustomerAccountId, OrganizationId, UserId } from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { jsonb, textEnum, timestamptz, uuid } from "./columns"

export const channelCustomersTable = SQLite.table("channel_customers", {
	columns: {
		channelId: uuid(ChannelId),
		organizationId: uuid(OrganizationId),
		accountId: uuid(CustomerAccountId),
		accountName: SQLite.text,
		/** The customer's logo (its account's `logoUrl`); null when it has none. */
		accountLogoUrl: SQLite.nullable(SQLite.text),
		updatedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		healthStatus: SQLite.column(textEnum(HealthStatus.literals), { default: "unknown" }),
		healthScore: SQLite.nullable(SQLite.integer),
		healthWhy: SQLite.nullable(SQLite.text),
		lifecycleStage: SQLite.nullable(textEnum(LifecycleStage.literals)),
		planName: SQLite.nullable(SQLite.text),
		mrrMinor: SQLite.nullable(SQLite.integer),
		currency: SQLite.nullable(SQLite.text),
		ownerUserId: SQLite.nullable(uuid(UserId)),
		seatsUsed: SQLite.nullable(SQLite.integer),
		seatsLimit: SQLite.nullable(SQLite.integer),
		/** `YYYY-MM-DD` (UTC). */
		lastActiveDay: SQLite.nullable(SQLite.text),
		openSignalCount: SQLite.column(SQLite.integer, { default: 0 }),
		topSignals: SQLite.column(jsonb<ReadonlyArray<ChannelCustomerModel.Signal>>(), { default: [] }),
		sourceLinks: SQLite.column(jsonb<ReadonlyArray<ChannelCustomerModel.SourceLink>>(), {
			default: [],
		}),
	},
	primaryKey: ["channelId"],
	indexes: [SQLite.index("channel_customers_account_idx", ["accountId"])],
})
export type ChannelCustomer = SQLite.SelectRowOf<typeof channelCustomersTable>
