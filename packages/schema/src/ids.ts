import { Schema } from "effect"

export const ChannelId = Schema.String.check(Schema.isUUID())
	.pipe(Schema.brand("@HazelChat/ChannelId"))
	.annotate({
		description: "The ID of the channel where the message is posted",
		title: "Channel ID",
	})
export type ChannelId = Schema.Schema.Type<typeof ChannelId>

export const ConnectConversationId = Schema.String.check(Schema.isUUID())
	.pipe(Schema.brand("@HazelChat/ConnectConversationId"))
	.annotate({
		description: "The ID of a Hazel Connect conversation",
		title: "Connect Conversation ID",
	})
export type ConnectConversationId = Schema.Schema.Type<typeof ConnectConversationId>

export const ConnectConversationChannelId = Schema.String.check(Schema.isUUID())
	.pipe(Schema.brand("@HazelChat/ConnectConversationChannelId"))
	.annotate({
		description: "The ID of a Hazel Connect conversation channel mount",
		title: "Connect Conversation Channel ID",
	})
export type ConnectConversationChannelId = Schema.Schema.Type<typeof ConnectConversationChannelId>

export const ConnectInviteId = Schema.String.check(Schema.isUUID())
	.pipe(Schema.brand("@HazelChat/ConnectInviteId"))
	.annotate({
		description: "The ID of a Hazel Connect invite",
		title: "Connect Invite ID",
	})
export type ConnectInviteId = Schema.Schema.Type<typeof ConnectInviteId>

export const ConnectParticipantId = Schema.String.check(Schema.isUUID())
	.pipe(Schema.brand("@HazelChat/ConnectParticipantId"))
	.annotate({
		description: "The ID of a Hazel Connect participant projection",
		title: "Connect Participant ID",
	})
export type ConnectParticipantId = Schema.Schema.Type<typeof ConnectParticipantId>

export const UserId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("@HazelChat/UserId")).annotate({
	description: "The ID of a user",
	title: "UserId ID",
})
export type UserId = Schema.Schema.Type<typeof UserId>

export const BotId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("@HazelChat/BotId")).annotate({
	description: "The ID of a bot",
	title: "Bot ID",
})
export type BotId = Schema.Schema.Type<typeof BotId>

export const MessageId = Schema.String.check(Schema.isUUID())
	.pipe(Schema.brand("@HazelChat/MessageId"))
	.annotate({
		description: "The ID of the message being replied to",
		title: "Reply To Message ID",
	})
export type MessageId = Schema.Schema.Type<typeof MessageId>

export const MessageReactionId = Schema.String.check(Schema.isUUID())
	.pipe(Schema.brand("@HazelChat/MessageReactionId"))
	.annotate({
		description: "The ID of the message reaction",
		title: "Message Reaction ID",
	})
export type MessageReactionId = Schema.Schema.Type<typeof MessageReactionId>

export const AttachmentId = Schema.String.check(Schema.isUUID())
	.pipe(Schema.brand("@HazelChat/AttachmentId"))
	.annotate({
		description: "The ID of the attachment being replied to",
		title: "Attachment ID",
	})
export type AttachmentId = Schema.Schema.Type<typeof AttachmentId>

export const OrganizationId = Schema.String.check(Schema.isUUID())
	.pipe(Schema.brand("@HazelChat/OrganizationId"))
	.annotate({
		description: "The ID of the organization",
		title: "Organization ID",
	})
export type OrganizationId = Schema.Schema.Type<typeof OrganizationId>

export const PinnedMessageId = Schema.String.check(Schema.isUUID())
	.pipe(Schema.brand("@HazelChat/PinnedMessageId"))
	.annotate({
		description: "The ID of the pinned message",
		title: "Pinned Message ID",
	})
export type PinnedMessageId = Schema.Schema.Type<typeof PinnedMessageId>

export const NotificationId = Schema.String.check(Schema.isUUID())
	.pipe(Schema.brand("@HazelChat/NotificationId"))
	.annotate({
		description: "The ID of the notification",
		title: "Notification ID",
	})
export type NotificationId = Schema.Schema.Type<typeof NotificationId>

export const ChannelMemberId = Schema.String.check(Schema.isUUID())
	.pipe(Schema.brand("@HazelChat/ChannelMemberId"))
	.annotate({
		description: "The ID of the channel member",
		title: "Channel Member ID",
	})
export type ChannelMemberId = Schema.Schema.Type<typeof ChannelMemberId>

export const OrganizationMemberId = Schema.String.check(Schema.isUUID())
	.pipe(Schema.brand("@HazelChat/OrganizationMemberId"))
	.annotate({
		description: "The ID of the organization member",
		title: "Organization Member ID",
	})
export type OrganizationMemberId = Schema.Schema.Type<typeof OrganizationMemberId>

export const TypingIndicatorId = Schema.String.check(Schema.isUUID())
	.pipe(Schema.brand("@HazelChat/TypingIndicatorId"))
	.annotate({
		description: "The ID of the typing indicator",
		title: "Typing Indicator ID",
	})
export type TypingIndicatorId = Schema.Schema.Type<typeof TypingIndicatorId>

export const UserPresenceStatusId = Schema.String.check(Schema.isUUID())
	.pipe(Schema.brand("@HazelChat/UserPresenceStatusId"))
	.annotate({
		description: "The ID of the user presence status",
		title: "User Presence Status ID",
	})
export type UserPresenceStatusId = Schema.Schema.Type<typeof UserPresenceStatusId>

export const IntegrationConnectionId = Schema.String.check(Schema.isUUID())
	.pipe(Schema.brand("@HazelChat/IntegrationConnectionId"))
	.annotate({
		description: "The ID of an integration connection",
		title: "Integration Connection ID",
	})
export type IntegrationConnectionId = Schema.Schema.Type<typeof IntegrationConnectionId>

export const SyncConnectionId = Schema.String.check(Schema.isUUID())
	.pipe(Schema.brand("@HazelChat/SyncConnectionId"))
	.annotate({
		description: "The ID of a chat sync connection",
		title: "Sync Connection ID",
	})
export type SyncConnectionId = Schema.Schema.Type<typeof SyncConnectionId>

export const ExternalChannelId = Schema.String.pipe(Schema.brand("@HazelChat/ExternalChannelId")).annotate({
	description: "The external channel identifier from a synced provider",
	title: "External Channel ID",
})
export type ExternalChannelId = Schema.Schema.Type<typeof ExternalChannelId>

export const ExternalMessageId = Schema.String.pipe(Schema.brand("@HazelChat/ExternalMessageId")).annotate({
	description: "The external message identifier from a synced provider",
	title: "External Message ID",
})
export type ExternalMessageId = Schema.Schema.Type<typeof ExternalMessageId>

export const ExternalWebhookId = Schema.String.pipe(Schema.brand("@HazelChat/ExternalWebhookId")).annotate({
	description: "The external webhook identifier from a synced provider",
	title: "External Webhook ID",
})
export type ExternalWebhookId = Schema.Schema.Type<typeof ExternalWebhookId>

export const ExternalUserId = Schema.String.pipe(Schema.brand("@HazelChat/ExternalUserId")).annotate({
	description: "The external user identifier from a synced provider",
	title: "External User ID",
})
export type ExternalUserId = Schema.Schema.Type<typeof ExternalUserId>

export const ExternalThreadId = Schema.String.pipe(Schema.brand("@HazelChat/ExternalThreadId")).annotate({
	description: "The external thread identifier from a synced provider",
	title: "External Thread ID",
})
export type ExternalThreadId = Schema.Schema.Type<typeof ExternalThreadId>

export const SyncChannelLinkId = Schema.String.check(Schema.isUUID())
	.pipe(Schema.brand("@HazelChat/SyncChannelLinkId"))
	.annotate({
		description: "The ID of a chat sync channel link",
		title: "Sync Channel Link ID",
	})
export type SyncChannelLinkId = Schema.Schema.Type<typeof SyncChannelLinkId>

export const SyncMessageLinkId = Schema.String.check(Schema.isUUID())
	.pipe(Schema.brand("@HazelChat/SyncMessageLinkId"))
	.annotate({
		description: "The ID of a chat sync message link",
		title: "Sync Message Link ID",
	})
export type SyncMessageLinkId = Schema.Schema.Type<typeof SyncMessageLinkId>

export const SyncEventReceiptId = Schema.String.check(Schema.isUUID())
	.pipe(Schema.brand("@HazelChat/SyncEventReceiptId"))
	.annotate({
		description: "The ID of a chat sync event receipt",
		title: "Sync Event Receipt ID",
	})
export type SyncEventReceiptId = Schema.Schema.Type<typeof SyncEventReceiptId>

export const IntegrationTokenId = Schema.String.check(Schema.isUUID())
	.pipe(Schema.brand("@HazelChat/IntegrationTokenId"))
	.annotate({
		description: "The ID of an integration token record",
		title: "Integration Token ID",
	})
export type IntegrationTokenId = Schema.Schema.Type<typeof IntegrationTokenId>

export const ChannelWebhookId = Schema.String.check(Schema.isUUID())
	.pipe(Schema.brand("@HazelChat/ChannelWebhookId"))
	.annotate({
		description: "The ID of a channel webhook",
		title: "Channel Webhook ID",
	})
export type ChannelWebhookId = Schema.Schema.Type<typeof ChannelWebhookId>

export const ChannelIcon = Schema.String.pipe(Schema.brand("@HazelChat/ChannelIcon")).annotate({
	description: "An emoji icon for a channel",
	title: "Channel Icon",
})
export type ChannelIcon = Schema.Schema.Type<typeof ChannelIcon>

export const GitHubSubscriptionId = Schema.String.check(Schema.isUUID())
	.pipe(Schema.brand("@HazelChat/GitHubSubscriptionId"))
	.annotate({
		description: "The ID of a GitHub subscription",
		title: "GitHub Subscription ID",
	})
export type GitHubSubscriptionId = Schema.Schema.Type<typeof GitHubSubscriptionId>

export const BotCommandId = Schema.String.check(Schema.isUUID())
	.pipe(Schema.brand("@HazelChat/BotCommandId"))
	.annotate({
		description: "The ID of a bot command",
		title: "Bot Command ID",
	})
export type BotCommandId = Schema.Schema.Type<typeof BotCommandId>

export const BotInstallationId = Schema.String.check(Schema.isUUID())
	.pipe(Schema.brand("@HazelChat/BotInstallationId"))
	.annotate({
		description: "The ID of a bot installation",
		title: "Bot Installation ID",
	})
export type BotInstallationId = Schema.Schema.Type<typeof BotInstallationId>

export const ChannelSectionId = Schema.String.check(Schema.isUUID())
	.pipe(Schema.brand("@HazelChat/ChannelSectionId"))
	.annotate({
		description: "The ID of a channel section",
		title: "Channel Section ID",
	})
export type ChannelSectionId = Schema.Schema.Type<typeof ChannelSectionId>

export const RssSubscriptionId = Schema.String.check(Schema.isUUID())
	.pipe(Schema.brand("@HazelChat/RssSubscriptionId"))
	.annotate({
		description: "The ID of an RSS subscription",
		title: "RSS Subscription ID",
	})
export type RssSubscriptionId = Schema.Schema.Type<typeof RssSubscriptionId>

export const IntegrationRequestId = Schema.String.check(Schema.isUUID())
	.pipe(Schema.brand("@HazelChat/IntegrationRequestId"))
	.annotate({
		description: "The ID of an integration request",
		title: "Integration Request ID",
	})
export type IntegrationRequestId = Schema.Schema.Type<typeof IntegrationRequestId>

export const CustomEmojiId = Schema.String.check(Schema.isUUID())
	.pipe(Schema.brand("@HazelChat/CustomEmojiId"))
	.annotate({
		description: "The ID of a custom emoji",
		title: "Custom Emoji ID",
	})
export type CustomEmojiId = Schema.Schema.Type<typeof CustomEmojiId>

export const InvitationId = Schema.String.check(Schema.isUUID())
	.pipe(Schema.brand("@HazelChat/InvitationId"))
	.annotate({
		description: "The ID of an email invitation to an organization",
		title: "Invitation ID",
	})
export type InvitationId = Schema.Schema.Type<typeof InvitationId>
