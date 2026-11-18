/**
 * `message_agent_marks`: which messages an agent wrote for their author (Hazel's MCP server). The
 * message handlers call these inside their write's transaction, so a mark commits with its message.
 * The mark names the author's organization (their `channel_viewers` row, which in a Connect channel
 * differs from the host's), and the sync source streams it only to viewers of that organization.
 */
import { Database, SQLite, schema } from "@hazel/db"
import type { MessageId } from "@hazel/schema"
import { Effect, Option } from "effect"
import { CurrentAgent } from "../principal"
import { channelOrganization, type MessageRow } from "./message-events"

/** Mark `message` as written by the current agent; nothing for the user's own calls. */
export const markAgentWrite = (message: MessageRow) =>
	Effect.gen(function* () {
		const agent = yield* Effect.serviceOption(CurrentAgent)
		if (Option.isNone(agent)) return
		const db = yield* Database.Database
		const viewer = yield* db.first(
			SQLite.from(schema.channelViewersTable)
				.select()
				.where(($) => [$.userId.eq(message.authorId)]),
		)
		const organizationId = Option.isSome(viewer)
			? Option.some(viewer.value.organizationId)
			: yield* channelOrganization
		if (Option.isNone(organizationId)) {
			return yield* Effect.logWarning("Agent write in a channel with no organization", {
				messageId: message.id,
			})
		}
		const row = {
			id: message.id,
			channelId: message.channelId,
			organizationId: organizationId.value,
			authorId: message.authorId,
			grantId: agent.value.grantId,
			agentName: agent.value.name,
		}
		yield* db.run(
			SQLite.insertInto(schema.messageAgentMarksTable)
				.values(row)
				.onConflictDoUpdate({
					target: ["id"],
					set: { grantId: row.grantId, agentName: row.agentName, updatedAt: new Date() },
				}),
		)
	}).pipe(Effect.withSpan("AgentMarks.markWrite"))

/** Drop a deleted message's mark. */
export const deleteAgentMark = (messageId: MessageId) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		yield* db.run(SQLite.deleteFrom(schema.messageAgentMarksTable).where(($) => [$.id.eq(messageId)]))
	})
