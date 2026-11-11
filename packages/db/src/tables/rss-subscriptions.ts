import { ChannelId, MessageId, OrganizationId, RssSubscriptionId, UserId } from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { randomUuid, timestamptz, uuid, varchar } from "./columns"

export const rssPostedItemsTable = SQLite.table("rss_posted_items", {
	columns: {
		id: SQLite.column(SQLite.text, { defaultExpr: randomUuid }),
		subscriptionId: uuid(RssSubscriptionId),
		itemGuid: SQLite.text,
		itemUrl: SQLite.nullable(SQLite.text),
		messageId: SQLite.nullable(uuid(MessageId)),
		postedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.index("rss_posted_items_subscription_id_idx", ["subscriptionId"]),
		SQLite.uniqueIndex("rss_posted_items_sub_guid_unique", ["subscriptionId", "itemGuid"]),
	],
})
export type RssPostedItem = SQLite.SelectRowOf<typeof rssPostedItemsTable>
export type NewRssPostedItem = SQLite.InsertRowOf<typeof rssPostedItemsTable>

export const rssSubscriptionsTable = SQLite.table("rss_subscriptions", {
	columns: {
		id: SQLite.column(uuid(RssSubscriptionId), { defaultExpr: randomUuid }),
		channelId: uuid(ChannelId),
		organizationId: uuid(OrganizationId),
		feedUrl: SQLite.text,
		feedTitle: SQLite.nullable(varchar(255)),
		feedIconUrl: SQLite.nullable(SQLite.text),
		lastFetchedAt: SQLite.nullable(timestamptz),
		lastItemPublishedAt: SQLite.nullable(timestamptz),
		lastItemGuid: SQLite.nullable(SQLite.text),
		consecutiveErrors: SQLite.column(SQLite.integer, { default: 0 }),
		lastErrorMessage: SQLite.nullable(SQLite.text),
		lastErrorAt: SQLite.nullable(timestamptz),
		isEnabled: SQLite.column(SQLite.boolean, { default: true }),
		pollingIntervalMinutes: SQLite.column(SQLite.integer, { default: 15 }),
		createdBy: uuid(UserId),
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		updatedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		deletedAt: SQLite.nullable(timestamptz),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.index("rss_subscriptions_channel_id_idx", ["channelId"]),
		SQLite.index("rss_subscriptions_organization_id_idx", ["organizationId"]),
		SQLite.index("rss_subscriptions_deleted_at_idx", ["deletedAt"]),
		SQLite.index("rss_subscriptions_poll_idx", ["isEnabled", "lastFetchedAt", "deletedAt"]),
	],
})
export type RssSubscription = SQLite.SelectRowOf<typeof rssSubscriptionsTable>
export type NewRssSubscription = SQLite.InsertRowOf<typeof rssSubscriptionsTable>
