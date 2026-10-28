import { Database, SQLite, Repository, schema } from "@hazel/db"

import type { ChannelId, ConnectConversationId, MessageId, OrganizationId, UserId } from "@hazel/schema"
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

		const backfillConversationIdForChannel = (
			channelId: ChannelId,
			conversationId: ConnectConversationId,
		) =>
			db.run(
				SQLite.update(schema.messagesTable)
					.set(($) => ({
						conversationId,
						updatedAt: SQLite.coalesce($.updatedAt, schema.now()),
					}))
					.where(($) => [
						$.channelId.eq(channelId),
						$.deletedAt.isNull(),
						$.conversationId.isNull(),
					]),
			)

		/**
		 * Reassign message authors for external chat-synced messages scoped to a provider + org.
		 * Used when a user links/unlinks their external account and historical messages need re-attribution.
		 */
		const reassignExternalSyncedAuthors = (params: {
			organizationId: OrganizationId
			provider: string
			fromAuthorId: UserId
			toAuthorId: UserId
		}) =>
			Effect.gen(function* () {
				if (params.fromAuthorId === params.toAuthorId) {
					return 0
				}

				const externalLinkedMessageIds = SQLite.from(schema.chatSyncMessageLinksTable, "message_link")
					.innerJoin(schema.chatSyncChannelLinksTable, "channel_link", (link, channelLink) =>
						channelLink.id.eq(link.channelLinkId).and(channelLink.deletedAt.isNull()),
					)
					.innerJoin(schema.chatSyncConnectionsTable, "connection", (_link, connection) =>
						connection.deletedAt.isNull(),
					)
					.select(($) => ({ hazelMessageId: $.hazelMessageId }))
					.where(($) => [
						$.connection.id.eq($.channel_link.syncConnectionId),
						$.source.eq("external"),
						$.deletedAt.isNull(),
						$.connection.organizationId.eq(params.organizationId),
						$.connection.provider.eq(params.provider),
					])

				const updatedMessages = yield* db.run(
					SQLite.update(schema.messagesTable)
						.set({ authorId: params.toAuthorId, updatedAt: new Date() })
						.where(($) => [
							$.authorId.eq(params.fromAuthorId),
							$.deletedAt.isNull(),
							SQLite.inSubquery($.id, externalLinkedMessageIds),
						])
						.returning("id"),
				)

				return updatedMessages.length
			})

		return {
			...baseRepo,
			listByChannel,
			findByIdForCursor,
			reassignExternalSyncedAuthors,
			backfillConversationIdForChannel,
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
