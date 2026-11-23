/**
 * `channel.exportPage`: one page of a channel's rows for its organization's data export
 * (`../org/exports.ts`), read in the channel's `ChannelObject`. Pages go by `id` (ascending), so
 * the org resumes a channel from the last id it wrote. Soft-deleted rows are left out; rows cross
 * as JSON (timestamps as ISO strings).
 *
 * Only the org's own object calls it (cross-object calls never reach a client).
 */
import { Database, SQLite, schema } from "@hazel/db"
import { AttachmentId, MessageId, MessageReactionId, PinnedMessageId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { defineCall } from "../calls"

/** The tables a channel contributes, in the order the export reads them. */
export const CHANNEL_EXPORT_TABLES = [
	"messages",
	"message_reactions",
	"pinned_messages",
	"attachments",
] as const
export const ChannelExportTable = Schema.Literals(CHANNEL_EXPORT_TABLES)
export type ChannelExportTable = typeof ChannelExportTable.Type

/** A DO call's answer is capped well above this; a page of messages stays around a megabyte. */
export const CHANNEL_EXPORT_MAX_PAGE = 500

export const ChannelExportPageCall = defineCall("channel.exportPage", "channel", {
	payload: Schema.Struct({
		table: ChannelExportTable,
		/** The last id the previous page returned; `null` for the first page. */
		after: Schema.NullOr(Schema.String),
		limit: Schema.Finite,
	}),
	success: Schema.Struct({
		rows: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
		/** The id to pass as `after` for the next page; `null` when this was the last. */
		next: Schema.NullOr(Schema.String),
	}),
	error: Schema.Never,
})

/** Dates as ISO strings, so a row survives the call and goes straight into NDJSON. */
const toJson = (row: { readonly id: string }): Record<string, unknown> => JSON.parse(JSON.stringify(row))

const readPage = (table: ChannelExportTable, after: string | null, limit: number) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		switch (table) {
			case "messages":
				return yield* db.run(
					SQLite.from(schema.messagesTable)
						.select(
							"id",
							"channelId",
							"conversationId",
							"authorId",
							"content",
							"embeds",
							"replyToMessageId",
							"threadChannelId",
							"createdAt",
							"updatedAt",
						)
						.where(($) => [
							$.deletedAt.isNull(),
							after === null ? undefined : $.id.gt(MessageId.make(after)),
						])
						.orderBy(($) => [[$.id, "asc"]])
						.limit(limit),
				)
			case "message_reactions":
				return yield* db.run(
					SQLite.from(schema.messageReactionsTable)
						.select("id", "messageId", "channelId", "userId", "emoji", "createdAt")
						.where(($) => [after === null ? undefined : $.id.gt(MessageReactionId.make(after))])
						.orderBy(($) => [[$.id, "asc"]])
						.limit(limit),
				)
			case "pinned_messages":
				return yield* db.run(
					SQLite.from(schema.pinnedMessagesTable)
						.select("id", "channelId", "messageId", "pinnedBy", "pinnedAt")
						.where(($) => [after === null ? undefined : $.id.gt(PinnedMessageId.make(after))])
						.orderBy(($) => [[$.id, "asc"]])
						.limit(limit),
				)
			case "attachments":
				return yield* db.run(
					SQLite.from(schema.attachmentsTable)
						.select(
							"id",
							"channelId",
							"messageId",
							"fileName",
							"fileSize",
							"externalUrl",
							"uploadedBy",
							"status",
							"uploadedAt",
						)
						.where(($) => [
							$.deletedAt.isNull(),
							$.status.eq("complete"),
							after === null ? undefined : $.id.gt(AttachmentId.make(after)),
						])
						.orderBy(($) => [[$.id, "asc"]])
						.limit(limit),
				)
		}
	})

export const exportPage = Effect.fn("ChannelObject.exportPage")(
	function* (payload: typeof ChannelExportPageCall.payload.Type) {
		const limit = Math.max(1, Math.min(CHANNEL_EXPORT_MAX_PAGE, Math.floor(payload.limit)))
		const rows: ReadonlyArray<{ readonly id: string }> = yield* readPage(
			payload.table,
			payload.after,
			limit,
		)
		yield* Effect.annotateCurrentSpan({ "export.table": payload.table, "export.rows": rows.length })
		return {
			rows: rows.map(toJson),
			next: rows.length < limit ? null : (rows[rows.length - 1]?.id ?? null),
		}
	},
	Effect.catchTag("DatabaseError", (error) => Effect.die(error)),
)
