import {
	Assistant,
	Attachment,
	Bot,
	BotCommand,
	BotInstallation,
	Channel,
	ChannelActivity,
	ChannelMember,
	ChannelSection,
	ChannelCustomer,
	ChatSyncChannelLink,
	ChatSyncConnection,
	ChatSyncMessageLink,
	ConnectConversation,
	ConnectConversationChannel,
	CustomerChatAuthor,
	CustomEmoji,
	IntegrationConnection,
	JsonDate,
	Message,
	MessageAgentMark,
	MessageReaction,
	Notification,
	NotificationOverride,
	Organization,
	OrganizationExport,
	OrganizationMember,
	PinnedMessage,
	TypingIndicator,
	User,
	UserGroup,
	UserPresenceStatus,
} from "@hazel/domain/models"
import { OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import {
	type CollectionSources,
	channelPartition,
	createEffectCollection,
	type EffectCollection,
} from "@hazel/effect-db-collection"
import * as Customers from "@hazel/domain/customers"
import type { PersistOptions } from "./platform/services"
import { type Sync, unionSources } from "./sync"

/**
 * Collections over the Durable Object sources (`./sync.ts`): the user's own object, the orgs it
 * belongs to (plus Connect host orgs), and on demand the channels a query names by `channelId`.
 * Rows are keyed by `id`, the server's `pk`.
 */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

/**
 * Rows carry timestamps as ISO text; the models' `JsonDate` would decode that to a `DateTime`, while
 * the app reads `Date`s, so ISO timestamp strings are parsed into `Date`s first.
 */
export const parseTimestamps = (row: unknown): unknown => {
	if (typeof row !== "object" || row === null) return row
	const parsed: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(row)) {
		parsed[key] = typeof value === "string" && ISO_TIMESTAMP.test(value) ? new Date(value) : value
	}
	return parsed
}

/**
 * Bump it when what the cache stores changes outside the models (e.g. `parseTimestamps`): every
 * collection's stored rows are dropped. A model's own changes need no bump (`cacheVersionOf`).
 */
const CACHE_EPOCH = 5

/**
 * The local cache's version of a collection's stored rows (`./local-cache.ts`): a hash of its model,
 * so a changed model drops that collection's rows and stored seq, and its source sends a snapshot.
 * Stored rows are not decoded again, so a row kept from before a field was added would lack it.
 */
export const cacheVersionOf = (schema: Schema.Top): number => {
	const text = `${CACHE_EPOCH}:${JSON.stringify(Schema.toJsonSchemaDocument(schema))}`
	// FNV-1a, 32 bits: a non-negative integer, as the persistence requires.
	let hash = 0x811c9dc5
	for (let index = 0; index < text.length; index++) {
		hash ^= text.charCodeAt(index)
		hash = Math.imul(hash, 0x01000193)
	}
	return hash >>> 0
}

/** The user's organizations (`UserObject`): which `OrgObject`s to open. Keyed by `organizationId`. */
export const UserOrganization = Schema.Struct({
	organizationId: OrganizationId,
	joinedAt: JsonDate,
})
export type UserOrganization = typeof UserOrganization.Type

export interface CollectionDeps {
	readonly sync: Sync
	readonly persist: PersistOptions | undefined
}

/** Every synced collection, over one sync hub and one local cache. */
export const makeCollections = (deps: CollectionDeps) => {
	const { syncHub, orgSources, userSources, customersSources } = deps.sync

	/** Keeps an eager collection's rows on disk while the local cache is on. */
	const persist = (schema: Schema.Top) => deps.persist?.(cacheVersionOf(schema))

	const syncedCollection = <A extends { readonly id: string }>(
		table: string,
		schema: Schema.Schema<A>,
		sources: CollectionSources,
	): EffectCollection<A> =>
		createEffectCollection<A, string | number>(
			{
				id: table,
				table,
				schema,
				parseRow: parseTimestamps,
				getKey: (item) => item.id,
				hub: syncHub,
				sources,
			},
			// Channel-partitioned collections keep nothing: a channel's source sends its snapshot.
			"partition" in sources ? undefined : persist(schema),
		)

	const orgCollection = <A extends { readonly id: string }>(table: string, schema: Schema.Schema<A>) =>
		syncedCollection(table, schema, orgSources)

	const channelCollectionOf = <A extends { readonly id: string }>(
		table: string,
		schema: Schema.Schema<A>,
	) => syncedCollection(table, schema, channelPartition())

	const userOrganizationCollection = createEffectCollection(
		{
			id: "user_organizations",
			table: "user_organizations",
			schema: UserOrganization,
			parseRow: parseTimestamps,
			getKey: (row) => row.organizationId,
			hub: syncHub,
			sources: userSources,
		},
		persist(UserOrganization),
	)

	const organizationCollection = orgCollection("organizations", Organization.Schema)
	const messageCollection = channelCollectionOf("messages", Message.Schema)
	const messageReactionCollection = channelCollectionOf("message_reactions", MessageReaction.Schema)
	/** Messages an agent wrote for their author (the author's organization only). */
	const messageAgentMarkCollection = channelCollectionOf("message_agent_marks", MessageAgentMark.Schema)
	const pinnedMessageCollection = channelCollectionOf("pinned_messages", PinnedMessage.Schema)
	const notificationCollection = syncedCollection("notifications", Notification.Schema, userSources)
	const userCollection = orgCollection("users", User.Schema)
	const organizationMemberCollection = orgCollection("organization_members", OrganizationMember.Schema)
	const channelCollection = orgCollection("channels", Channel.Schema)
	const connectConversationCollection = orgCollection("connect_conversations", ConnectConversation.Schema)
	const connectConversationChannelCollection = orgCollection(
		"connect_conversation_channels",
		ConnectConversationChannel.Schema,
	)
	const channelMemberCollection = orgCollection("channel_members", ChannelMember.Schema)
	const channelSectionCollection = orgCollection("channel_sections", ChannelSection.Schema)
	/** The organization's user groups (Discord's mentionable roles), for `@handle` mentions. */
	const userGroupCollection = orgCollection("user_groups", UserGroup.Schema)
	/** Who is in each user group. Keyed by `groupId:userId`. */
	const userGroupMemberCollection = createEffectCollection(
		{
			id: "user_group_members",
			table: "user_group_members",
			schema: UserGroup.MemberSchema,
			parseRow: parseTimestamps,
			getKey: (row) => `${row.groupId}:${row.userId}`,
			hub: syncHub,
			sources: orgSources,
		},
		persist(UserGroup.MemberSchema),
	)
	const attachmentCollection = channelCollectionOf("attachments", Attachment.Schema)
	const typingIndicatorCollection = channelCollectionOf("typing_indicators", TypingIndicator.Schema)
	const userPresenceStatusCollection = syncedCollection(
		"user_presence_status",
		UserPresenceStatus.Schema,
		unionSources(userSources, orgSources),
	)
	const integrationConnectionCollection = orgCollection(
		"integration_connections",
		IntegrationConnection.Schema,
	)
	const chatSyncConnectionCollection = orgCollection("chat_sync_connections", ChatSyncConnection.Schema)
	const chatSyncChannelLinkCollection = orgCollection("chat_sync_channel_links", ChatSyncChannelLink.Schema)
	const chatSyncMessageLinkCollection = channelCollectionOf(
		"chat_sync_message_links",
		ChatSyncMessageLink.Schema,
	)
	/**
	 * Each channel's newest message (`channel_activity`): with the user's read position, whether the
	 * channel is unread (`core/lib/unread.ts`). Keyed by `channelId`; members who see the channel only.
	 */
	const channelActivityCollection = createEffectCollection(
		{
			id: "channel_activity",
			table: "channel_activity",
			schema: ChannelActivity.Schema,
			parseRow: parseTimestamps,
			getKey: (row) => row.channelId,
			hub: syncHub,
			sources: orgSources,
		},
		persist(ChannelActivity.Schema),
	)
	/**
	 * The user's own read position in each channel (`channel_read_state`; nobody else's is sent).
	 * Keyed by `channelId:userId`.
	 */
	const channelReadStateCollection = createEffectCollection(
		{
			id: "channel_read_state",
			table: "channel_read_state",
			schema: ChannelActivity.ReadState,
			parseRow: parseTimestamps,
			getKey: (row) => `${row.channelId}:${row.userId}`,
			hub: syncHub,
			sources: orgSources,
		},
		persist(ChannelActivity.ReadState),
	)
	/**
	 * The user's own organization and section notification settings (`notification_overrides`).
	 * Keyed by `userId:scope:scopeId`.
	 */
	const notificationOverrideCollection = createEffectCollection(
		{
			id: "notification_overrides",
			table: "notification_overrides",
			schema: NotificationOverride.Schema,
			parseRow: parseTimestamps,
			getKey: (row) => `${row.userId}:${row.scope}:${row.scopeId}`,
			hub: syncHub,
			sources: orgSources,
		},
		persist(NotificationOverride.Schema),
	)
	/**
	 * Each linked channel's customer (`channel_customers`, the `CustomersObject`'s projection into the
	 * org): what chat shows on a channel. Keyed by `channelId`; members who see the channel only.
	 */
	const channelCustomerCollection = createEffectCollection(
		{
			id: "channel_customers",
			table: "channel_customers",
			schema: ChannelCustomer.Schema,
			parseRow: parseTimestamps,
			getKey: (row) => row.channelId,
			hub: syncHub,
			sources: orgSources,
		},
		persist(ChannelCustomer.Schema),
	)
	/**
	 * Who writes in the org's channels linked to customers (`customer_chat_authors`,
	 * `docs/customers/author-side.md`): each author's side (customer, team, bot, unknown), why, and a
	 * member's override. Keyed by `organizationId:userId`; the org's members only.
	 */
	const customerChatAuthorCollection = createEffectCollection(
		{
			id: "customer_chat_authors",
			table: "customer_chat_authors",
			schema: CustomerChatAuthor.Schema,
			parseRow: parseTimestamps,
			getKey: (row) => `${row.organizationId}:${row.userId}`,
			hub: syncHub,
			sources: orgSources,
		},
		persist(CustomerChatAuthor.Schema),
	)
	const botCollection = orgCollection("bots", Bot.Schema)
	const botCommandCollection = orgCollection("bot_commands", BotCommand.Schema)
	const botInstallationCollection = orgCollection("bot_installations", BotInstallation.Schema)
	const customEmojiCollection = orgCollection("custom_emojis", CustomEmoji.Schema)
	/** Data exports and their progress (owners and admins only; `organizationExport.*`). */
	const organizationExportCollection = orgCollection("organization_exports", OrganizationExport.Schema)
	/** The AI panel's threads and their items: the member's own, and those shared with the org. */
	const assistantThreadCollection = orgCollection("assistant_threads", Assistant.Thread)
	const assistantItemCollection = orgCollection("assistant_items", Assistant.Item)

	// Customers (`docs/customers/tech-design.md` §6): the org's `CustomersObject`, opened when the
	// Customers area is first entered (`openCustomersSource`). Filter by `organizationId`.
	const customersCollection = <A extends { readonly id: string }>(
		table: string,
		schema: Schema.Schema<A>,
	) => syncedCollection(table, schema, customersSources)

	const customerAccountCollection = customersCollection("customer_accounts", Customers.Account.Schema)
	const customerSignalCollection = customersCollection("customer_signals", Customers.Signal.Schema)
	const customerIssueCollection = customersCollection("customer_issues", Customers.Issue.Schema)
	const customerIssueSlaCollection = customersCollection("customer_issue_slas", Customers.IssueSla.Schema)
	const customerSignalRuleCollection = customersCollection(
		"customer_signal_rules",
		Customers.SignalRule.Schema,
	)
	const customerSlaPolicyCollection = customersCollection(
		"customer_sla_policies",
		Customers.SlaPolicy.Schema,
	)
	const customerNoteCollection = customersCollection("customer_notes", Customers.Note.Schema)
	const customerSavedViewCollection = customersCollection(
		"customer_saved_views",
		Customers.SavedView.Schema,
	)
	const customerViewLayoutCollection = customersCollection(
		"customer_view_layouts",
		Customers.ViewLayout.Schema,
	)
	const customerSettingsCollection = customersCollection("customer_settings", Customers.Settings.Schema)
	const customerMetricDefinitionCollection = customersCollection(
		"customer_metric_definitions",
		Customers.MetricDefinition.Schema,
	)
	const customerConnectionCollection = customersCollection(
		"customer_connections",
		Customers.Connection.Schema,
	)
	const customerSyncRunCollection = customersCollection("customer_sync_runs", Customers.SyncRun.Schema)
	const customerChannelLinkCollection = customersCollection(
		"customer_channel_links",
		Customers.ChannelLink.Schema,
	)
	/** Per account, who wrote in its linked channels and their side. Keyed by `accountId:userId`. */
	const customerChatParticipantCollection = createEffectCollection(
		{
			id: "customer_chat_participants",
			table: "customer_chat_participants",
			schema: Customers.ChatParticipant,
			parseRow: parseTimestamps,
			getKey: (row) => `${row.accountId}:${row.userId}`,
			hub: syncHub,
			sources: customersSources,
		},
		persist(Customers.ChatParticipant),
	)
	const customerFeatureFlagCollection = customersCollection(
		"customer_feature_flags",
		Customers.FeatureFlag.Schema,
	)
	const customerImpersonatorCollection = customersCollection(
		"customer_impersonators",
		Customers.Impersonator.Schema,
	)
	const customerImpersonationCollection = customersCollection(
		"customer_impersonations",
		Customers.Impersonation.Schema,
	)

	return {
		userOrganizationCollection,
		organizationCollection,
		messageCollection,
		messageReactionCollection,
		messageAgentMarkCollection,
		pinnedMessageCollection,
		notificationCollection,
		userCollection,
		organizationMemberCollection,
		channelCollection,
		connectConversationCollection,
		connectConversationChannelCollection,
		channelMemberCollection,
		channelSectionCollection,
		userGroupCollection,
		userGroupMemberCollection,
		attachmentCollection,
		typingIndicatorCollection,
		userPresenceStatusCollection,
		integrationConnectionCollection,
		chatSyncConnectionCollection,
		chatSyncChannelLinkCollection,
		chatSyncMessageLinkCollection,
		channelActivityCollection,
		channelReadStateCollection,
		notificationOverrideCollection,
		channelCustomerCollection,
		customerChatAuthorCollection,
		botCollection,
		botCommandCollection,
		botInstallationCollection,
		customEmojiCollection,
		organizationExportCollection,
		assistantThreadCollection,
		assistantItemCollection,
		customerAccountCollection,
		customerSignalCollection,
		customerIssueCollection,
		customerIssueSlaCollection,
		customerSignalRuleCollection,
		customerSlaPolicyCollection,
		customerNoteCollection,
		customerSavedViewCollection,
		customerViewLayoutCollection,
		customerSettingsCollection,
		customerMetricDefinitionCollection,
		customerConnectionCollection,
		customerSyncRunCollection,
		customerChannelLinkCollection,
		customerChatParticipantCollection,
		customerFeatureFlagCollection,
		customerImpersonatorCollection,
		customerImpersonationCollection,
	}
}

export type Collections = ReturnType<typeof makeCollections>
