/**
 * `channel.liveAccess`: what a `MessageLiveObject` asks the message's channel before it serves a
 * principal: the message's author (its only writer) and whether the user reads the channel.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { MessageNotFoundError } from "@hazel/domain"
import { MessageId, UserId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import { defineCall } from "../calls"

export const LiveAccessCall = defineCall("channel.liveAccess", "channel", {
	payload: Schema.Struct({ messageId: MessageId, userId: UserId }),
	success: Schema.Struct({ authorId: UserId, viewer: Schema.Boolean }),
	error: MessageNotFoundError,
})

export const liveAccess = Effect.fn("ChannelObject.liveAccess")(
	function* (payload: typeof LiveAccessCall.payload.Type) {
		const db = yield* Database.Database
		const message = yield* db.first(
			SQLite.from(schema.messagesTable)
				.select("authorId")
				.where(($) => [$.id.eq(payload.messageId), $.deletedAt.isNull()])
				.limit(1),
		)
		if (Option.isNone(message)) return yield* new MessageNotFoundError({ messageId: payload.messageId })
		const viewer = yield* db.first(
			SQLite.from(schema.channelViewersTable)
				.select("userId")
				.where(($) => [$.userId.eq(payload.userId)])
				.limit(1),
		)
		return { authorId: message.value.authorId, viewer: Option.isSome(viewer) }
	},
	Effect.catchTag("DatabaseError", (error) => Effect.die(error)),
)
