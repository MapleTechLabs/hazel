/**
 * What the `CustomersObject` asks a linked channel about its messages:
 *
 * - `channel.supportMessage`: before it opens a support issue on one of them by hand
 *   (`customers.issue.createFromMessage`): the message, if the user reads the channel. `not_found`
 *   for a missing, deleted or unreadable one alike.
 * - `channel.supportContext`: before it triages a conversation (`../customers/triage.ts`): this
 *   channel's messages leading up to one of them. Read by the object for the model only; it
 *   reaches no user, so there is nobody whose access could be checked. Calls arrive over the
 *   Worker's own Durable Object bindings (`../calls.ts`), never from a client.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { MessageNotFoundError } from "@hazel/domain"
import { ChannelId, MessageId, UserId } from "@hazel/schema"
import { DateTime, Effect, Option, Schema } from "effect"
import { defineCall } from "../calls"

export const SupportMessageCall = defineCall("channel.supportMessage", "channel", {
	payload: Schema.Struct({ messageId: MessageId, userId: UserId }),
	success: Schema.Struct({
		authorId: UserId,
		/** Epoch ms. */
		sentAt: Schema.Finite,
		content: Schema.String,
		threadChannelId: Schema.NullOr(ChannelId),
	}),
	error: MessageNotFoundError,
})

export const supportMessage = Effect.fn("ChannelObject.supportMessage")(
	function* (payload: typeof SupportMessageCall.payload.Type) {
		const db = yield* Database.Database
		const viewer = yield* db.first(
			SQLite.from(schema.channelViewersTable)
				.select("userId")
				.where(($) => [$.userId.eq(payload.userId)])
				.limit(1),
		)
		const message = Option.isNone(viewer)
			? Option.none()
			: yield* db.first(
					SQLite.from(schema.messagesTable)
						.select("authorId", "createdAt", "content", "threadChannelId")
						.where(($) => [$.id.eq(payload.messageId), $.deletedAt.isNull()])
						.limit(1),
				)
		if (Option.isNone(message)) return yield* new MessageNotFoundError({ messageId: payload.messageId })
		const { createdAt } = message.value
		return {
			authorId: message.value.authorId,
			sentAt: createdAt instanceof Date ? createdAt.getTime() : DateTime.toEpochMillis(createdAt),
			content: message.value.content,
			threadChannelId: message.value.threadChannelId,
		}
	},
	Effect.catchTag("DatabaseError", (error) => Effect.die(error)),
)

/** A message's text as triage reads it: enough to judge, no more. */
export const SUPPORT_CONTEXT_TEXT_MAX = 500

export const SupportContextCall = defineCall("channel.supportContext", "channel", {
	payload: Schema.Struct({
		/** The message the conversation is read around. */
		messageId: MessageId,
		/** Epoch ms: nothing older is returned. */
		since: Schema.Finite,
		/** Epoch ms: nothing newer is returned, so a late read sees what an early one did. */
		until: Schema.Finite,
		limit: Schema.Int,
	}),
	success: Schema.Struct({
		/**
		 * The channel's live messages from `since` to `until`, oldest first: the newest `limit` of
		 * them, and the message itself whenever it is no older than `since`.
		 */
		messages: Schema.Array(
			Schema.Struct({
				id: MessageId,
				authorId: UserId,
				/** Epoch ms. */
				sentAt: Schema.Finite,
				content: Schema.String,
			}),
		),
	}),
	error: MessageNotFoundError,
})

export const supportContext = Effect.fn("ChannelObject.supportContext")(
	function* (payload: typeof SupportContextCall.payload.Type) {
		const db = yield* Database.Database
		const anchor = yield* db.first(
			SQLite.from(schema.messagesTable)
				.select("id", "authorId", "createdAt", "content")
				.where(($) => [$.id.eq(payload.messageId), $.deletedAt.isNull()])
				.limit(1),
		)
		if (Option.isNone(anchor)) return yield* new MessageNotFoundError({ messageId: payload.messageId })
		const window = yield* db.run(
			SQLite.from(schema.messagesTable)
				.select("id", "authorId", "createdAt", "content")
				.where(($) => [
					$.deletedAt.isNull(),
					$.createdAt.gte(new Date(payload.since)),
					$.createdAt.lte(new Date(payload.until)),
				])
				.orderBy(($) => [[$.createdAt, "desc"]])
				.limit(Math.max(1, Math.min(payload.limit, 50))),
		)
		const messages = [...window, anchor.value]
			.map((row) => ({
				id: row.id,
				authorId: row.authorId,
				sentAt:
					row.createdAt instanceof Date
						? row.createdAt.getTime()
						: DateTime.toEpochMillis(row.createdAt),
				content: Array.from(row.content).slice(0, SUPPORT_CONTEXT_TEXT_MAX).join(""),
			}))
			// The message is in the window, or was crowded out of it: once either way.
			.filter(
				(message, index, all) =>
					message.sentAt >= payload.since &&
					all.findIndex((other) => other.id === message.id) === index,
			)
			.sort((a, b) => a.sentAt - b.sentAt)
		return { messages }
	},
	Effect.catchTag("DatabaseError", (error) => Effect.die(error)),
)
