import {
	Attachment,
	Bot,
	BotCommand,
	BotInstallation,
	Channel,
	ChannelMember,
	ChannelSection,
	ChatSyncChannelLink,
	ChatSyncConnection,
	ChatSyncMessageLink,
	ConnectConversation,
	ConnectConversationChannel,
	ConnectParticipant,
	CustomEmoji,
	IntegrationConnection,
	JsonDate,
	Message,
	MessageReaction,
	Notification,
	Organization,
	OrganizationMember,
	PinnedMessage,
	TypingIndicator,
	User,
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
import { orgSources, syncHub, unionSources, userSources } from "./sync"

/**
 * Collections over the Durable Object sources (`./sync.ts`): the user's own object, the orgs it
 * belongs to (plus Connect host orgs), and on demand the channels a query names by `channelId`.
 * Rows are keyed by `id`, the server's `pk`.
 */
const syncedCollection = <A extends { readonly id: string }>(
	table: string,
	schema: Schema.Schema<A>,
	sources: CollectionSources,
): EffectCollection<A> =>
	createEffectCollection<A, string | number>({
		id: table,
		table,
		schema,
		getKey: (item) => item.id,
		hub: syncHub,
		sources,
	})

const orgCollection = <A extends { readonly id: string }>(table: string, schema: Schema.Schema<A>) =>
	syncedCollection(table, schema, orgSources)

const channelCollectionOf = <A extends { readonly id: string }>(table: string, schema: Schema.Schema<A>) =>
	syncedCollection(table, schema, channelPartition())

/** The user's organizations (`UserObject`): which `OrgObject`s to open. Keyed by `organizationId`. */
export const UserOrganization = Schema.Struct({
	organizationId: OrganizationId,
	joinedAt: JsonDate,
})
export type UserOrganization = typeof UserOrganization.Type

export const userOrganizationCollection = createEffectCollection({
	id: "user_organizations",
	table: "user_organizations",
	schema: UserOrganization,
	getKey: (row) => row.organizationId,
	hub: syncHub,
	sources: userSources,
})

export const organizationCollection = orgCollection("organizations", Organization.Schema)
export const messageCollection = channelCollectionOf("messages", Message.Schema)
export const messageReactionCollection = channelCollectionOf("message_reactions", MessageReaction.Schema)
export const pinnedMessageCollection = channelCollectionOf("pinned_messages", PinnedMessage.Schema)
export const notificationCollection = syncedCollection("notifications", Notification.Schema, userSources)
export const userCollection = orgCollection("users", User.Schema)
export const organizationMemberCollection = orgCollection("organization_members", OrganizationMember.Schema)
export const channelCollection = orgCollection("channels", Channel.Schema)
export const connectConversationCollection = orgCollection(
	"connect_conversations",
	ConnectConversation.Schema,
)
export const connectConversationChannelCollection = orgCollection(
	"connect_conversation_channels",
	ConnectConversationChannel.Schema,
)
export const connectParticipantCollection = orgCollection("connect_participants", ConnectParticipant.Schema)
export const channelMemberCollection = orgCollection("channel_members", ChannelMember.Schema)
export const channelSectionCollection = orgCollection("channel_sections", ChannelSection.Schema)
export const attachmentCollection = channelCollectionOf("attachments", Attachment.Schema)
export const typingIndicatorCollection = channelCollectionOf("typing_indicators", TypingIndicator.Schema)
export const userPresenceStatusCollection = syncedCollection(
	"user_presence_status",
	UserPresenceStatus.Schema,
	unionSources(userSources, orgSources),
)
export const integrationConnectionCollection = orgCollection(
	"integration_connections",
	IntegrationConnection.Schema,
)
export const chatSyncConnectionCollection = orgCollection("chat_sync_connections", ChatSyncConnection.Schema)
export const chatSyncChannelLinkCollection = orgCollection(
	"chat_sync_channel_links",
	ChatSyncChannelLink.Schema,
)
export const chatSyncMessageLinkCollection = channelCollectionOf(
	"chat_sync_message_links",
	ChatSyncMessageLink.Schema,
)
export const botCollection = orgCollection("bots", Bot.Schema)
export const botCommandCollection = orgCollection("bot_commands", BotCommand.Schema)
export const botInstallationCollection = orgCollection("bot_installations", BotInstallation.Schema)
export const customEmojiCollection = orgCollection("custom_emojis", CustomEmoji.Schema)
