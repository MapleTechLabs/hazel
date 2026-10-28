import { ChannelId, ConnectConversationId, MessageId, MessageReactionId, UserId } from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { jsonb, randomUuid, timestamptz, uuid, varchar } from "./columns"

// Embed types for JSONB column
export interface MessageEmbedAuthor {
	name: string
	url?: string
	iconUrl?: string
}

export interface MessageEmbedFooter {
	text: string
	iconUrl?: string
}

export interface MessageEmbedField {
	name: string
	value: string
	inline?: boolean
}

export interface MessageEmbedBadge {
	text: string
	color?: number // Hex color as integer
}

/**
 * Cached snapshot of live state for non-realtime clients.
 * Synced on finalize when the actor completes.
 */
export interface MessageEmbedLiveStateCached {
	status: "idle" | "active" | "completed" | "failed"
	data: Record<string, unknown>
	text?: string
	progress?: number
	error?: string
}

/**
 * Live state configuration for messages with attached RivetKit actors.
 * Used for real-time updates like deployment status or AI streaming.
 */
export interface MessageEmbedLiveState {
	// Whether this message has an attached actor
	enabled: true
	// Cached snapshot for non-realtime clients (synced on finalize)
	cached?: MessageEmbedLiveStateCached
}

export interface MessageEmbed {
	title?: string
	description?: string
	url?: string
	color?: number // Hex color as integer
	author?: MessageEmbedAuthor
	footer?: MessageEmbedFooter
	image?: { url: string }
	thumbnail?: { url: string }
	fields?: MessageEmbedField[]
	timestamp?: string // ISO 8601 timestamp
	badge?: MessageEmbedBadge // Status badge (e.g., "Deployed", "Failed")
	liveState?: MessageEmbedLiveState // Live state for real-time updates
}

export const messageReactionsTable = SQLite.table("message_reactions", {
	columns: {
		id: SQLite.column(uuid(MessageReactionId), { defaultExpr: randomUuid }),
		messageId: uuid(MessageId),
		channelId: uuid(ChannelId),
		conversationId: SQLite.nullable(uuid(ConnectConversationId)),
		userId: uuid(UserId),
		emoji: varchar(50),
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.uniqueIndex("reactions_message_user_emoji_unique", ["messageId", "userId", "emoji"]),
		SQLite.index("reactions_channel_id_idx", ["channelId"]),
		SQLite.index("reactions_conversation_id_idx", ["conversationId"]),
		SQLite.index("reactions_message_id_idx", ["messageId"]),
		SQLite.index("reactions_user_id_idx", ["userId"]),
		SQLite.index("reactions_message_user_emoji_idx", ["messageId", "userId", "emoji"]),
	],
})
export type MessageReaction = SQLite.SelectRowOf<typeof messageReactionsTable>
export type NewMessageReaction = SQLite.InsertRowOf<typeof messageReactionsTable>

export const messagesTable = SQLite.table("messages", {
	columns: {
		id: SQLite.column(uuid(MessageId), { defaultExpr: randomUuid }),
		channelId: uuid(ChannelId),
		conversationId: SQLite.nullable(uuid(ConnectConversationId)),
		authorId: uuid(UserId),
		content: SQLite.text,
		embeds: SQLite.nullable(jsonb<MessageEmbed[]>()),
		replyToMessageId: SQLite.nullable(uuid(MessageId)),
		threadChannelId: SQLite.nullable(uuid(ChannelId)),
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		updatedAt: SQLite.nullable(timestamptz),
		deletedAt: SQLite.nullable(timestamptz),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.index("messages_channel_id_idx", ["channelId"]),
		SQLite.index("messages_conversation_id_idx", ["conversationId"]),
		SQLite.index("messages_author_id_idx", ["authorId"]),
		SQLite.index("messages_reply_to_idx", ["replyToMessageId"]),
		SQLite.index("messages_thread_channel_idx", ["threadChannelId"]),
		SQLite.index("messages_created_at_idx", ["createdAt"]),
		SQLite.index("messages_deleted_at_idx", ["deletedAt"]),
	],
})
export type Message = SQLite.SelectRowOf<typeof messagesTable>
export type NewMessage = SQLite.InsertRowOf<typeof messagesTable>
