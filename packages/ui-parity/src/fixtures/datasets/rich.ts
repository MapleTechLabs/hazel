import type { Dataset, Row } from "../dataset.ts"
import { stableId } from "../ids.ts"
import { defaultDataset } from "./default.ts"
import {
	asset,
	at,
	channelId,
	channelKeys,
	memberId,
	orgId,
	userId,
	type PersonKey,
	type RichChannelKey,
} from "./rich/base.ts"
import {
	announcementMessages,
	customEmojis,
	launchMessages,
	launchReactions,
	longMessages,
	pinnedMessages,
	standupMessages,
	threadMessages,
	typingIndicators,
} from "./rich/conversation.ts"
import {
	botRows,
	botUsers,
	chatSyncChannelLinks,
	chatSyncConnections,
	chatSyncMessageLinks,
	integrationMessages,
} from "./rich/integrations.ts"
import { attachments, mediaMessages } from "./rich/media.ts"

/**
 * The `default` workspace plus every message feature: threads, embeds, attachments, pins, custom
 * emoji, bots, a Discord-synced message, date separators, typing and a channel Ada hasn't joined.
 */

const katherine: Row = {
	id: userId("katherine"),
	externalId: "user_katherine",
	email: "katherine@hazel.test",
	firstName: "Katherine",
	lastName: "Johnson",
	// The one teammate with an uploaded avatar, served by the fixture backend.
	avatarUrl: asset("avatars/katherine-128x128.png"),
	userType: "user",
	settings: null,
	isOnboarded: true,
	timezone: "UTC",
	createdAt: at(-90, "12:00"),
	updatedAt: null,
	deletedAt: null,
}

const channelNames: Record<RichChannelKey, string> = {
	launch: "launch",
	"launch-thread": "Launch checklist",
	github: "github",
	deploys: "deploys",
	status: "status",
	links: "links",
	media: "media",
	"long-reads": "long-reads",
	standup: "standup",
	announcements: "announcements",
}

const channels: Row[] = channelKeys.map((key) => ({
	id: channelId(key),
	name: channelNames[key],
	icon: null,
	type: key === "launch-thread" ? "thread" : "public",
	organizationId: orgId,
	parentChannelId: key === "launch-thread" ? channelId("launch") : null,
	sectionId: null,
	createdAt: at(-30, "12:00"),
	updatedAt: null,
	deletedAt: null,
}))

const everyone: PersonKey[] = ["ada", "grace", "alan", "margaret", "linus", "katherine"]
const channelMembers: Row[] = channelKeys.flatMap((channel) =>
	everyone
		.filter((person) => !(channel === "announcements" && person === "ada"))
		.map((person) => ({
			id: memberId(channel, person),
			channelId: channelId(channel),
			userId: userId(person),
			isHidden: false,
			isMuted: false,
			isFavorite: false,
			lastSeenMessageId: null,
			notificationCount: 0,
			joinedAt: at(-30, "12:00"),
			createdAt: at(-30, "12:00"),
			deletedAt: null,
		})),
)

const base = defaultDataset.tables

export const richDataset: Dataset = {
	...defaultDataset,
	name: "rich",
	tables: {
		...base,
		users: [...base.users!, katherine, ...botUsers],
		organization_members: [
			...base.organization_members!,
			{
				id: stableId("rich:org-member:katherine"),
				organizationId: orgId,
				userId: userId("katherine"),
				role: "member",
				nickname: null,
				joinedAt: at(-90, "12:00"),
				invitedBy: null,
				deletedAt: null,
				createdAt: at(-90, "12:00"),
			},
		],
		channels: [...base.channels!, ...channels],
		channel_members: [...base.channel_members!, ...channelMembers],
		messages: [
			...base.messages!,
			...launchMessages,
			...threadMessages,
			...longMessages,
			...standupMessages,
			...announcementMessages,
			...integrationMessages,
			...mediaMessages,
		],
		message_reactions: [...base.message_reactions!, ...launchReactions],
		pinned_messages: pinnedMessages,
		custom_emojis: customEmojis,
		attachments,
		bots: botRows,
		typing_indicators: typingIndicators,
		chat_sync_connections: chatSyncConnections,
		chat_sync_channel_links: chatSyncChannelLinks,
		chat_sync_message_links: chatSyncMessageLinks,
		user_presence_status: [
			...base.user_presence_status!,
			{
				id: stableId("rich:presence:katherine"),
				userId: userId("katherine"),
				status: "online",
				customMessage: "Shipping the launch",
				statusEmoji: "🚀",
				statusExpiresAt: null,
				activeChannelId: null,
				suppressNotifications: false,
				updatedAt: at(0, "14:55"),
				lastSeenAt: at(0, "14:55"),
			},
		],
	},
}

/** Scenario paths into the rich workspace. */
export const richChat = (key: RichChannelKey) => `/hazel/chat/${channelId(key)}`
