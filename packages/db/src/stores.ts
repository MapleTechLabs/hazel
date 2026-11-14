/**
 * The tables each store holds (see `infra/durable-object-sync-plan.md` §1). A projection table
 * (a read-only copy written through its owner's outbox) appears in its owner's store and in each
 * store it is projected into, with the same schema.
 */
import * as schema from "./tables"

export type StoreName = "directory" | "org" | "channel" | "user" | "customers"

/** D1, global: identities, auth, bots, invitations and the routing indexes. */
export const directoryTables = [
	schema.usersTable,
	schema.authCredentialsTable,
	schema.authIdentifiersTable,
	schema.authSessionsTable,
	schema.authPendingTable,
	schema.authPasskeyCredentialsTable,
	schema.authPasskeyFlowsTable,
	schema.authOAuthFlowsTable,
	schema.authOAuthLoginsTable,
	schema.authOAuthIdentitiesTable,
	schema.authOAuthRegistrationsTable,
	schema.yieldedBrowserLoginTable,
	schema.botsTable,
	schema.botCommandsTable,
	schema.organizationInvitationsTable,
	schema.connectInvitesTable,
	schema.orgIndexTable,
	schema.membershipIndexTable,
	schema.channelIndexTable,
	schema.webhookIndexTable,
	schema.integrationIndexTable,
	schema.chatSyncIndexTable,
	schema.chatSyncInstallationsTable,
	schema.pushDeviceTokensTable,
] as const

/** `OrgObject`, one per organization. */
export const orgTables = [
	schema.organizationsTable,
	schema.organizationMembersTable,
	schema.channelsTable,
	schema.channelMembersTable,
	schema.channelSectionsTable,
	schema.channelAccessTable,
	schema.customEmojisTable,
	schema.botInstallationsTable,
	schema.botInstallGrantsTable,
	schema.integrationConnectionsTable,
	schema.integrationTokensTable,
	schema.integrationRequestsTable,
	schema.chatSyncConnectionsTable,
	schema.chatSyncChannelLinksTable,
	schema.channelWebhooksTable,
	schema.githubSubscriptionsTable,
	schema.rssSubscriptionsTable,
	schema.rssPostedItemsTable,
	schema.connectConversationsTable,
	schema.connectConversationChannelsTable,
	schema.connectParticipantsTable,
	// Projections: members and Connect participants, their presence, the installed bots.
	schema.usersTable,
	schema.userPresenceStatusTable,
	schema.botsTable,
	schema.botCommandsTable,
] as const

/** `ChannelObject`, one per channel (threads too). */
export const channelTables = [
	schema.messagesTable,
	schema.messageReactionsTable,
	schema.pinnedMessagesTable,
	schema.attachmentsTable,
	schema.chatSyncMessageLinksTable,
	schema.chatSyncEventReceiptsTable,
	schema.typingIndicatorsTable,
	// Projections from the `OrgObject`.
	schema.channelViewersTable,
	schema.channelBotsTable,
] as const

/** `UserObject`, one per user. */
export const userTables = [
	schema.notificationsTable,
	schema.userPresenceStatusTable,
	schema.userOrganizationsTable,
	// Not synced: the push devices.
	schema.pushDevicesTable,
] as const

/**
 * `CustomersObject`, one per organization (`docs/customers/tech-design.md`): customer accounts,
 * their billing and usage, signals, health and data sources.
 */
export const customersTables = [
	schema.customerAccountsTable,
	schema.customerContactsTable,
	schema.customerExternalRefsTable,
	schema.customerSubscriptionsTable,
	schema.customerInvoicesTable,
	schema.customerActivityDailyTable,
	schema.customerMetricDefinitionsTable,
	schema.customerMetricDailyTable,
	schema.customerOrgDailyTable,
	schema.customerEventsTable,
	schema.customerMrrMovementsTable,
	schema.customerSignalRulesTable,
	schema.customerSignalsTable,
	schema.customerSettingsTable,
	schema.customerHealthDailyTable,
	schema.customerNotesTable,
	schema.customerSavedViewsTable,
	schema.customerConnectionsTable,
	schema.customerConnectionSecretsTable,
	schema.customerSyncRunsTable,
	schema.customerUnmatchedRecordsTable,
	schema.customerIgnoreRulesTable,
	// Projection from the `OrgObject`.
	schema.customerMembersTable,
] as const

export const storeTables = {
	directory: directoryTables,
	org: orgTables,
	channel: channelTables,
	user: userTables,
	customers: customersTables,
} as const satisfies Record<StoreName, ReadonlyArray<unknown>>

export const storeNames: ReadonlyArray<StoreName> = ["directory", "org", "channel", "user", "customers"]
