/**
 * Threads across `ChannelObject`s. A thread's first message stays in the parent channel's object;
 * the thread's own object holds its replies.
 *
 * - `channel.setThreadChannel` (to the parent, from the `OrgObject`'s `channel.createThread`):
 *   point the message at its thread, then tell the thread where it came from.
 * - `channel.setThreadOrigin` (to the thread): the original message, kept in `_object_meta`. It
 *   marks the object as a thread's and gives naming (`../effects/ai-effects.ts`) its context.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { ChannelId, MessageId, UserId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import { enqueueEffect, defineEffect } from "../effects/registry"
import { writeObjectMeta } from "../meta"
import { InboundChatSyncWrite } from "../../../services/chat-sync/chat-sync-effects"
import { ChatSyncOutbound, enqueueChatSyncOutbound } from "../../../services/chat-sync/chat-sync-outbound"

export const SetThreadChannelPayload = Schema.Struct({
	messageId: MessageId,
	threadChannelId: ChannelId,
})
export type SetThreadChannelPayload = typeof SetThreadChannelPayload.Type

export const ThreadOrigin = Schema.Struct({
	parentChannelId: ChannelId,
	messageId: MessageId,
	authorId: UserId,
	content: Schema.String,
})
export type ThreadOrigin = typeof ThreadOrigin.Type

/** `channel.setThreadChannel` itself is in `ChannelEffects` (sent by the org's `createThread`). */
export const ThreadEffects = {
	setThreadOrigin: defineEffect("channel.setThreadOrigin", "channel", ThreadOrigin),
}

const THREAD_ORIGIN_KEY = "threadOrigin"
/** Set once the thread asked to be named, so it is named automatically once. */
const THREAD_NAMING_KEY = "threadNamingRequested"

const ThreadOriginJson = Schema.fromJsonString(ThreadOrigin)

/** The thread's original message, when this object is a thread's. */
export const readThreadOrigin = Effect.gen(function* () {
	const db = yield* Database.Database
	const rows = yield* db.query(
		Database.sql`SELECT value FROM _object_meta WHERE key = ${THREAD_ORIGIN_KEY}`,
	)
	return Option.flatMap(Option.fromNullishOr(rows[0]?.value), (json) =>
		Schema.decodeUnknownOption(ThreadOriginJson)(json),
	)
})

/** First link wins: a message already pointing at a thread keeps it (two racing creates). */
export const setThreadChannel = Effect.fn("ChannelEffects.setThreadChannel")(function* (
	payload: SetThreadChannelPayload,
) {
	const db = yield* Database.Database
	const updated = yield* db.run(
		SQLite.update(schema.messagesTable)
			.set({ threadChannelId: payload.threadChannelId })
			.where(($) => [
				$.id.eq(payload.messageId),
				SQLite.or($.threadChannelId.isNull(), $.threadChannelId.eq(payload.threadChannelId)),
			])
			.returning("id", "channelId", "authorId", "content"),
	)
	const message = updated[0]
	yield* Effect.annotateCurrentSpan({ "thread.linked": message !== undefined })
	if (message === undefined) {
		return yield* Effect.logWarning("Thread link skipped: message missing or already linked", payload)
	}
	// Mirror the thread on the channel's outbound chat-sync links (a provider thread on the message).
	if (!(yield* InboundChatSyncWrite)) {
		yield* enqueueChatSyncOutbound(ChatSyncOutbound.threadCreated(message.id, payload.threadChannelId))
	}
	yield* enqueueEffect(
		ThreadEffects.setThreadOrigin,
		{ kind: "channel", id: payload.threadChannelId },
		{
			parentChannelId: message.channelId,
			messageId: message.id,
			authorId: message.authorId,
			content: message.content,
		},
	)
})

const setThreadOrigin = Effect.fn("ChannelEffects.setThreadOrigin")(function* (origin: ThreadOrigin) {
	yield* writeObjectMeta(THREAD_ORIGIN_KEY, yield* Schema.encodeEffect(ThreadOriginJson)(origin))
})

export const threadReceivers = {
	"channel.setThreadOrigin": setThreadOrigin,
}

/** Mark that this thread asked to be named; false when it already had. */
export const claimThreadNaming = Effect.gen(function* () {
	const db = yield* Database.Database
	const claimed = yield* db.query(Database.sql`INSERT INTO _object_meta (key, value)
		VALUES (${THREAD_NAMING_KEY}, '1') ON CONFLICT (key) DO NOTHING RETURNING key`)
	return claimed.length > 0
})
