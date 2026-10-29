/**
 * `channel.listMessages`: the public API's message page (`routes/api-v1/messages.http.ts`), read
 * in the channel's `ChannelObject`. Newest first, Stripe-style cursors; readable by the
 * channel's viewers only.
 */
import { MessageRepo } from "@hazel/backend-core"
import { Database, SQLite, schema } from "@hazel/db"
import { UnauthorizedError } from "@hazel/domain"
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
		limit: Schema.Number,
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
