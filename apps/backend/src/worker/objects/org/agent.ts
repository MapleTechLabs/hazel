/**
 * What Hazel's MCP server (`routes/mcp.ts`) reads of an `OrgObject` for an agent acting as a user:
 * the channels the user can open here (their `channel_access`, threads aside), with unread counts,
 * and for direct messages who else is in them.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { UnauthorizedError } from "@hazel/domain"
import { ChannelId, UserId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import { defineCall } from "../calls"
import { requireOrganizationId } from "./integrations"

export const AgentChannel = Schema.Struct({
	id: ChannelId,
	name: Schema.String,
	type: Schema.Literals(["public", "private", "direct", "single"]),
	unreadCount: Schema.Number,
	isMuted: Schema.Boolean,
	/** For direct messages: the other members' names. */
	members: Schema.Array(Schema.String),
})
export type AgentChannel = typeof AgentChannel.Type

export const AgentChannelsCall = defineCall("org.agentChannels", "org", {
	payload: Schema.Struct({ userId: UserId }),
	success: Schema.Array(AgentChannel),
	error: UnauthorizedError,
})

const DmMemberRow = Schema.Struct({
	channelId: Schema.String,
	firstName: Schema.String,
	lastName: Schema.String,
})

export const agentChannels = Effect.fn("OrgObject.agentChannels")(
	function* (payload: typeof AgentChannelsCall.payload.Type) {
		const organizationId = yield* requireOrganizationId
		const db = yield* Database.Database
		const member = yield* db.first(
			SQLite.from(schema.organizationMembersTable)
				.select("id")
				.where(($) => [
					$.organizationId.eq(organizationId),
					$.userId.eq(payload.userId),
					$.deletedAt.isNull(),
				])
				.limit(1),
		)
		if (Option.isNone(member)) {
			return yield* new UnauthorizedError({
				message: "You are not a member of this organization",
				detail: `organizationId=${organizationId}`,
			})
		}
		// Joins, not `IN` lists: a Durable Object binds at most 100 parameters.
		const channels = yield* db.run(
			SQLite.from(schema.channelAccessTable, "ca")
				.innerJoin(schema.channelsTable, "c", (ca, c) =>
					SQLite.and(c.id.eq(ca.channelId), c.deletedAt.isNull()),
				)
				.leftJoin(schema.channelMembersTable, "cm", (ca, cm) =>
					SQLite.and(cm.channelId.eq(ca.channelId), cm.userId.eq(ca.userId), cm.deletedAt.isNull()),
				)
				.select(($) => ({
					id: $.c.id,
					name: $.c.name,
					type: $.c.type,
					notificationCount: $.cm.notificationCount,
					isMuted: $.cm.isMuted,
				}))
				.where(($) => [
					$.organizationId.eq(organizationId),
					$.userId.eq(payload.userId),
					$.c.type.in_("public", "private", "direct", "single"),
				]),
		)
		const dmMembers = yield* db.query(
			Database.sql`SELECT cm."channelId" AS "channelId", u."firstName" AS "firstName", u."lastName" AS "lastName"
				FROM "channel_members" cm
				JOIN "channels" c ON c."id" = cm."channelId" AND c."type" IN ('direct', 'single') AND c."deletedAt" IS NULL
				JOIN "channel_access" ca ON ca."channelId" = cm."channelId" AND ca."userId" = ${payload.userId}
				JOIN "users" u ON u."id" = cm."userId"
				WHERE cm."userId" != ${payload.userId} AND cm."deletedAt" IS NULL`,
			DmMemberRow,
		)
		const membersOf = new Map<string, Array<string>>()
		for (const row of dmMembers) {
			const names = membersOf.get(row.channelId) ?? []
			names.push(`${row.firstName} ${row.lastName}`.trim())
			membersOf.set(row.channelId, names)
		}
		yield* Effect.annotateCurrentSpan({ "org.agent_channels": channels.length })
		return channels
			.flatMap((channel) =>
				channel.type === "thread"
					? []
					: [
							{
								id: channel.id,
								name: channel.name,
								type: channel.type,
								unreadCount: channel.notificationCount ?? 0,
								isMuted: channel.isMuted ?? false,
								members: membersOf.get(channel.id) ?? [],
							},
						],
			)
			.sort((a, b) => a.name.localeCompare(b.name))
	},
	Effect.catchTag("DatabaseError", (error) => Effect.die(error)),
)
