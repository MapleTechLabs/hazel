/**
 * What Hazel's MCP server (`routes/mcp.ts`) reads of a `UserObject` for an agent acting as its
 * user: their notifications (mentions, replies, direct messages), newest first.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { ChannelId, MessageId, NotificationId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { defineCall } from "../calls"

export const AgentNotification = Schema.Struct({
	id: NotificationId,
	channelId: Schema.NullOr(ChannelId),
	messageId: Schema.NullOr(MessageId),
	reason: Schema.NullOr(Schema.String),
	createdAt: Schema.Date,
	read: Schema.Boolean,
})
export type AgentNotification = typeof AgentNotification.Type

export const AgentNotificationsCall = defineCall("user.agentNotifications", "user", {
	payload: Schema.Struct({ unreadOnly: Schema.Boolean, limit: Schema.Finite }),
	success: Schema.Array(AgentNotification),
	error: Schema.Never,
})

export const agentNotifications = Effect.fn("UserObject.agentNotifications")(
	function* (payload: typeof AgentNotificationsCall.payload.Type) {
		const db = yield* Database.Database
		const rows = yield* db.run(
			SQLite.from(schema.notificationsTable)
				.select()
				.where(($) => [
					payload.unreadOnly ? $.readAt.isNull() : undefined,
					$.resourceType.eq("message"),
				])
				.orderBy(($) => [[$.createdAt, "desc"]])
				.limit(Math.max(1, Math.min(payload.limit, 100))),
		)
		return rows.map((row) => ({
			id: row.id,
			channelId:
				row.targetedResourceType === "channel" ? (row.targetedResourceId as ChannelId | null) : null,
			messageId: row.resourceId as MessageId | null,
			reason: row.reason,
			createdAt: row.createdAt,
			read: row.readAt !== null,
		}))
	},
	Effect.catchTag("DatabaseError", (error) => Effect.die(error)),
)
