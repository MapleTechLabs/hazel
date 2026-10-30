import { Database, SQLite, Repository, schema } from "@hazel/db"

import type { ChannelId, ConnectConversationId, MessageId } from "@hazel/schema"
import { Message } from "@hazel/domain/models"
import { Context, Effect, Layer } from "effect"

export interface ListByChannelParams {
	channelId: ChannelId
	conversationId?: ConnectConversationId
	/** Cursor tuple for older messages (fetch messages after this row in DESC order) */
	cursorBefore?: {
		id: MessageId
		createdAt: Date
	}
	/** Cursor tuple for newer messages (fetch messages before this row in DESC order) */
	cursorAfter?: {
		id: MessageId
		createdAt: Date
	}
	/** Maximum number of messages to return (fetch limit+1 to determine has_more) */
	limit: number
}

export class MessageRepo extends Context.Service<MessageRepo>()("MessageRepo", {
	make: Effect.gen(function* () {
		const baseRepo = yield* Repository.makeRepository(
			schema.messagesTable,
			{ insert: Message.Insert, update: Message.Update },
			{
				idColumn: "id",
				name: "Message",
			},
		)
		const db = yield* Database.Database

		/**
		 * List messages in a channel with cursor-based pagination (Stripe-style).
		 */
		const listByChannel = (params: ListByChannelParams) =>
			db.run(
				SQLite.from(schema.messagesTable)
					.select()
					.where(($) => [
						$.deletedAt.isNull(),
						params.conversationId
							? $.conversationId.eq(params.conversationId)
							: $.channelId.eq(params.channelId),
						SQLite.when(params.cursorBefore, (cursor) =>
							$.createdAt
								.lt(cursor.createdAt)
								.or($.createdAt.eq(cursor.createdAt).and($.id.lt(cursor.id))),
						),
						SQLite.when(params.cursorAfter, (cursor) =>
							$.createdAt
								.gt(cursor.createdAt)
								.or($.createdAt.eq(cursor.createdAt).and($.id.gt(cursor.id))),
						),
					])
					.orderBy(["createdAt", "desc"], ["id", "desc"])
					.limit(params.limit + 1),
			)

		/**
		 * Find a message by ID scoped to a channel for cursor resolution.
		 */
		const findByIdForCursor = (params: {
			id: MessageId
			channelId: ChannelId
			conversationId?: ConnectConversationId
		}) =>
			db.first(
				SQLite.from(schema.messagesTable)
					.select()
					.where(($) => [
						$.id.eq(params.id),
						params.conversationId
							? $.conversationId.eq(params.conversationId)
							: $.channelId.eq(params.channelId),
						$.deletedAt.isNull(),
					])
					.limit(1),
			)

		return {
			...baseRepo,
			listByChannel,
			findByIdForCursor,
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
