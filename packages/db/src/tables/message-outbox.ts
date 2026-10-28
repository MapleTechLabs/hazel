import { ChannelId, MessageOutboxEventId } from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { jsonb, randomUuid, textEnum, timestamptz, uuid, varchar } from "./columns"

export const messageOutboxEventTypeEnum = textEnum([
	"message_created",
	"message_updated",
	"message_deleted",
	"reaction_created",
	"reaction_deleted",
])
export const messageOutboxEventStatusEnum = textEnum(["pending", "processing", "processed", "failed"])

export const messageOutboxEventsTable = SQLite.table("message_outbox_events", {
	columns: {
		id: SQLite.column(uuid(MessageOutboxEventId), { defaultExpr: randomUuid }),
		// The rowid: SQLite assigns it on insert.
		sequence: SQLite.column(SQLite.integer, { defaultExpr: "(NULL)" }),
		eventType: messageOutboxEventTypeEnum,
		aggregateId: SQLite.text,
		channelId: uuid(ChannelId),
		payload: jsonb<Record<string, unknown>>(),
		status: SQLite.column(messageOutboxEventStatusEnum, { default: "pending" }),
		attemptCount: SQLite.column(SQLite.integer, { default: 0 }),
		availableAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		lockedAt: SQLite.nullable(timestamptz),
		lockedBy: SQLite.nullable(varchar(255)),
		lastError: SQLite.nullable(SQLite.text),
		processedAt: SQLite.nullable(timestamptz),
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
	},
	primaryKey: ["sequence"],
	indexes: [
		SQLite.uniqueIndex("message_outbox_events_id_unique", ["id"]),
		SQLite.index("message_outbox_events_status_available_sequence_idx", [
			"status",
			"availableAt",
			"sequence",
		]),
		SQLite.index("message_outbox_events_channel_sequence_idx", ["channelId", "sequence"]),
		SQLite.index("message_outbox_events_created_at_idx", ["createdAt"]),
	],
})
export type MessageOutboxEvent = SQLite.SelectRowOf<typeof messageOutboxEventsTable>
export type NewMessageOutboxEvent = SQLite.InsertRowOf<typeof messageOutboxEventsTable>
