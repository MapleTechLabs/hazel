/**
 * Message search across objects (`./org/message-search.ts` owns the index):
 *
 * - `org.indexMessages`: a `ChannelObject`'s message writes (`./channel/search-index.ts`), and
 *   the pages it answers a backfill with; indexed under the sending channel's id.
 * - `org.indexConnectMessages`: a Connect host org passing a host channel's index changes to
 *   each guest org, under the guest's mounted channel id.
 * - `channel.exportSearchMessages`: an org's backfill asks a channel for a page of its messages.
 */
import { ChannelId, ConnectConversationId, MessageId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { defineEffect } from "./effects/registry"

/** Where a backfill page ends: the last message sent, by `(createdAt, id)`. */
export const SearchCursor = Schema.Struct({ createdAt: Schema.Number, id: MessageId })
export type SearchCursor = typeof SearchCursor.Type

/** A message as the index takes it: raw content (the org makes it plain text), epoch ms. */
export const IndexedMessage = Schema.Struct({
	id: MessageId,
	authorId: UserId,
	conversationId: Schema.NullOr(ConnectConversationId),
	createdAt: Schema.Number,
	content: Schema.String,
})
export type IndexedMessage = typeof IndexedMessage.Type

export const IndexMessagesPayload = Schema.Struct({
	upsert: Schema.Array(IndexedMessage),
	remove: Schema.Array(MessageId),
	/** Set on a backfill answer. */
	page: Schema.optionalKey(
		Schema.Struct({
			generation: Schema.Number,
			/** The first page: drop what the index holds for the channel first. */
			replace: Schema.Boolean,
			/** Where the next page starts; `null` when this was the last. */
			next: Schema.NullOr(SearchCursor),
		}),
	),
})
export type IndexMessagesPayload = typeof IndexMessagesPayload.Type

export const IndexConnectMessagesPayload = Schema.Struct({
	conversationId: ConnectConversationId,
	/** The guest org's mounted channel. */
	channelId: ChannelId,
	upsert: Schema.Array(IndexedMessage),
	remove: Schema.Array(MessageId),
	replace: Schema.Boolean,
})
export type IndexConnectMessagesPayload = typeof IndexConnectMessagesPayload.Type

export const ExportSearchMessagesPayload = Schema.Struct({
	generation: Schema.Number,
	after: Schema.NullOr(SearchCursor),
})
export type ExportSearchMessagesPayload = typeof ExportSearchMessagesPayload.Type

export const SearchOrgEffects = {
	indexMessages: defineEffect("org.indexMessages", "org", IndexMessagesPayload),
	indexConnectMessages: defineEffect("org.indexConnectMessages", "org", IndexConnectMessagesPayload),
}

export const SearchChannelEffects = {
	exportSearchMessages: defineEffect(
		"channel.exportSearchMessages",
		"channel",
		ExportSearchMessagesPayload,
	),
}
