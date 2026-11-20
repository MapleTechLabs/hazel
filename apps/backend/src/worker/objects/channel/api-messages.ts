/**
 * `channel.listMessages`: the public API's message page (`routes/api-v1/messages.http.ts`), read
 * in the channel's `ChannelObject`. Newest first, Stripe-style cursors; readable by the
 * channel's viewers only.
 */
import { MessageRepo } from "@hazel/backend-core"
import { Database, SQLite, schema } from "@hazel/db"
import { MessageNotFoundError, UnauthorizedError } from "@hazel/domain"
import { InvalidPaginationError } from "@hazel/domain/http"
import { Message } from "@hazel/domain/models"
import { ChannelId, MessageId, UserId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import { ChannelViewers } from "../../../services/channel-viewers"
import { defineCall } from "../calls"

export const ListMessagesCall = defineCall("channel.listMessages", "channel", {
	payload: Schema.Struct({
		userId: UserId,
		channelId: ChannelId,
		startingAfter: Schema.NullOr(MessageId),
		endingBefore: Schema.NullOr(MessageId),
		limit: Schema.Finite,
	}),
	success: Schema.Struct({ messages: Schema.Array(Message.Schema), hasMore: Schema.Boolean }),
	error: Schema.Union([UnauthorizedError, InvalidPaginationError]),
})

export const listMessages = Effect.fn("ChannelObject.listMessages")(
	function* (payload: typeof ListMessagesCall.payload.Type) {
		const db = yield* Database.Database
		const messageRepo = yield* MessageRepo
		const viewers = yield* ChannelViewers
		const viewer = yield* db.first(
			SQLite.from(schema.channelViewersTable)
				.select("userId")
				.where(($) => [$.userId.eq(payload.userId)])
				.limit(1),
		)
		if (Option.isNone(viewer)) {
			return yield* new UnauthorizedError({
				message: "You can't read this channel",
				detail: `channelId=${payload.channelId}`,
			})
		}
		const conversationId = yield* viewers.conversationId
		const scope = { channelId: payload.channelId, ...(conversationId ? { conversationId } : {}) }

		const cursorOf = (id: MessageId, label: string) =>
			messageRepo.findByIdForCursor({ id, ...scope }).pipe(
				Effect.flatMap(
					Option.match({
						onNone: () =>
							Effect.fail(
								new InvalidPaginationError({
									message: `Invalid ${label} cursor for channel`,
								}),
							),
						onSome: (message) => Effect.succeed({ id: message.id, createdAt: message.createdAt }),
					}),
				),
			)
		const cursorBefore =
			payload.startingAfter === null
				? undefined
				: yield* cursorOf(payload.startingAfter, "starting_after")
		const cursorAfter =
			payload.endingBefore === null ? undefined : yield* cursorOf(payload.endingBefore, "ending_before")

		const rows = yield* messageRepo.listByChannel({
			...scope,
			cursorBefore,
			cursorAfter,
			limit: payload.limit,
		})
		const hasMore = rows.length > payload.limit
		yield* Effect.annotateCurrentSpan({ "messages.count": Math.min(rows.length, payload.limit) })
		return { messages: hasMore ? rows.slice(0, payload.limit) : rows, hasMore }
	},
	Effect.catchTag("DatabaseError", (error) => Effect.die(error)),
)

export const MessageThreadCall = defineCall("channel.messageThread", "channel", {
	payload: Schema.Struct({ userId: UserId, messageId: MessageId }),
	success: Schema.NullOr(ChannelId),
	error: Schema.Union([UnauthorizedError, MessageNotFoundError]),
})

/** The thread a message already has, for a viewer of its channel (`POST /api/v1/channels/:id/threads`). */
export const messageThread = Effect.fn("ChannelObject.messageThread")(
	function* (payload: typeof MessageThreadCall.payload.Type) {
		const db = yield* Database.Database
		const viewer = yield* db.first(
			SQLite.from(schema.channelViewersTable)
				.select("userId")
				.where(($) => [$.userId.eq(payload.userId)])
				.limit(1),
		)
		if (Option.isNone(viewer)) {
			return yield* new UnauthorizedError({
				message: "You can't read this channel",
				detail: `messageId=${payload.messageId}`,
			})
		}
		const message = yield* db.first(
			SQLite.from(schema.messagesTable)
				.select("threadChannelId")
				.where(($) => [$.id.eq(payload.messageId), $.deletedAt.isNull()])
				.limit(1),
		)
		if (Option.isNone(message)) return yield* new MessageNotFoundError({ messageId: payload.messageId })
		return message.value.threadChannelId
	},
	Effect.catchTag("DatabaseError", (error) => Effect.die(error)),
)

/** The most messages one `channel.messagesByIds` returns (DO SQLite binds at most 100 parameters). */
export const MESSAGES_BY_IDS_MAX = 50

export const MessagesByIdsCall = defineCall("channel.messagesByIds", "channel", {
	payload: Schema.Struct({ userId: UserId, ids: Schema.Array(MessageId) }),
	success: Schema.Array(Message.Schema),
	error: UnauthorizedError,
})

/** Messages by id, for a viewer of the channel (the MCP server's notifications and lookups). */
export const messagesByIds = Effect.fn("ChannelObject.messagesByIds")(
	function* (payload: typeof MessagesByIdsCall.payload.Type) {
		const db = yield* Database.Database
		const viewer = yield* db.first(
			SQLite.from(schema.channelViewersTable)
				.select("userId")
				.where(($) => [$.userId.eq(payload.userId)])
				.limit(1),
		)
		if (Option.isNone(viewer)) {
			return yield* new UnauthorizedError({
				message: "You can't read this channel",
				detail: "messagesByIds",
			})
		}
		const ids = payload.ids.slice(0, MESSAGES_BY_IDS_MAX)
		if (ids.length === 0) return []
		return yield* db.run(
			SQLite.from(schema.messagesTable)
				.select()
				.where(($) => [$.id.in_(...ids), $.deletedAt.isNull()]),
		)
	},
	Effect.catchTag("DatabaseError", (error) => Effect.die(error)),
)
