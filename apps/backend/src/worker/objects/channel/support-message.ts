/**
 * `channel.supportMessage`: what the `CustomersObject` asks a linked channel before it opens a
 * support issue on one of its messages by hand (`customers.issue.createFromMessage`): the message,
 * if the user reads the channel. `not_found` for a missing, deleted or unreadable one alike.
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
		sentAt: Schema.Number,
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
