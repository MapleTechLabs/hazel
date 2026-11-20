/**
 * `channel.reportChatAuthors` (`docs/customers/author-side.md`): the org linked this channel (or
 * its parent, for a thread) to a customer and asks who wrote here before. The channel answers
 * `org.chatAuthorsReported` with each author of its live messages (first and last message) and,
 * from a top-level channel, its threads, which the org asks in turn.
 */
import { Database, SQLite, schema } from "@hazel/db"
import type { ChannelId } from "@hazel/schema"
import { Effect, Option } from "effect"
import { CustomerChatOrgEffects, type ReportChatAuthorsPayload } from "../customer-chat-wire"
import { enqueueEffect } from "../effects/registry"
import { orgTarget } from "../kinds"
import { channelOrganization } from "./message-events"

/** `MIN`/`MAX` of the column may come back as stored text (SQLite's zoneless UTC form). */
const iso = (value: Date | string) =>
	(value instanceof Date ? value : schema.parseTimestamp(value)).toISOString()

export const reportChatAuthors = Effect.fn("ChannelObject.reportChatAuthors")(function* (
	payload: ReportChatAuthorsPayload,
) {
	const db = yield* Database.Database
	const authors = yield* db.run(
		SQLite.from(schema.messagesTable)
			.select(($) => ({
				userId: $.authorId,
				firstMessageAt: SQLite.min($.createdAt),
				lastMessageAt: SQLite.max($.createdAt),
			}))
			.where(($) => [$.deletedAt.isNull()])
			.groupBy("userId"),
	)
	const threads = yield* db.run(
		SQLite.from(schema.messagesTable)
			.select("threadChannelId")
			.distinct()
			.where(($) => [$.threadChannelId.isNotNull(), $.deletedAt.isNull()]),
	)
	const threadChannelIds = threads.flatMap((row) =>
		row.threadChannelId === null ? [] : [row.threadChannelId as ChannelId],
	)
	yield* Effect.annotateCurrentSpan({
		"customer_chat.authors": authors.length,
		"customer_chat.threads": threadChannelIds.length,
	})
	// The answer goes to the org that owns this channel, whatever the payload names.
	const organizationId = yield* channelOrganization
	if (Option.isNone(organizationId)) return
	yield* enqueueEffect(CustomerChatOrgEffects.chatAuthorsReported, orgTarget(organizationId.value), {
		linkedChannelId: payload.linkedChannelId,
		requestId: payload.requestId,
		authors: authors.flatMap((row) =>
			row.firstMessageAt === null || row.lastMessageAt === null
				? []
				: [
						{
							userId: row.userId,
							firstMessageAt: iso(row.firstMessageAt),
							lastMessageAt: iso(row.lastMessageAt),
						},
					],
		),
		threadChannelIds,
	})
})
