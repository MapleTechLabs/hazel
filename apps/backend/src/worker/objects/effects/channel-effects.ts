/**
 * Effects a `ChannelObject` receives. Its projections (`channel_viewers`, `channel_bots`) are
 * written only through these, by the channel's `OrgObject`.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { BotId, ConnectConversationId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import type { SqlClient } from "effect/sql/SqlClient"
import { deleteObjectMeta, writeObjectMeta } from "../meta"
import { defineEffect, type EffectReceivers } from "./registry"

export const ViewerRole = Schema.Literals(["owner", "admin", "member", "guest"])

export const ChannelViewer = Schema.Struct({
	userId: UserId,
	/** The viewer's own organization (a Connect guest's differs from the channel's). */
	organizationId: OrganizationId,
	role: ViewerRole,
})

/**
 * The channel's whole access, replacing the previous one: who may read it (its computed
 * `channel_access`), which bots receive its events, and the channel's org and conversation.
 * No viewers means the channel was deleted (or nobody may read it).
 */
export const SetViewersPayload = Schema.Struct({
	organizationId: OrganizationId,
	conversationId: Schema.NullOr(ConnectConversationId),
	viewers: Schema.Array(ChannelViewer),
	bots: Schema.Array(Schema.Struct({ botId: BotId, botUserId: UserId })),
})
export type SetViewersPayload = typeof SetViewersPayload.Type

export const ChannelEffects = {
	setViewers: defineEffect("channel.setViewers", "channel", SetViewersPayload),
}

/** Meta keys the channel's handlers read (see `../channel/channel-scope.ts`). */
export const CHANNEL_ORG_KEY = "organizationId"
export const CHANNEL_CONVERSATION_KEY = "conversationId"

/** Writes only what changed, so an unchanged viewer's sockets are not resnapshotted. */
const setViewers = Effect.fn("ChannelEffects.setViewers")(function* (payload: SetViewersPayload) {
	const db = yield* Database.Database
	const current = yield* db.run(SQLite.from(schema.channelViewersTable).select())
	const next = new Map(payload.viewers.map((viewer) => [viewer.userId, viewer]))
	const removed = current.filter((viewer) => !next.has(viewer.userId)).map((viewer) => viewer.userId)
	if (removed.length > 0) {
		yield* db.run(SQLite.deleteFrom(schema.channelViewersTable).where(($) => [$.userId.in_(...removed)]))
	}
	const byUser = new Map(current.map((viewer) => [viewer.userId, viewer]))
	const added = payload.viewers.filter((viewer) => !byUser.has(viewer.userId))
	const changed = payload.viewers.filter((viewer) => {
		const before = byUser.get(viewer.userId)
		return (
			before !== undefined &&
			(before.role !== viewer.role || before.organizationId !== viewer.organizationId)
		)
	})
	if (added.length > 0) {
		yield* db.run(
			SQLite.insertInto(schema.channelViewersTable).values(added.map((viewer) => ({ ...viewer }))),
		)
	}
	for (const viewer of changed) {
		yield* db.run(
			SQLite.update(schema.channelViewersTable)
				.set({ organizationId: viewer.organizationId, role: viewer.role })
				.where(($) => [$.userId.eq(viewer.userId)]),
		)
	}

	yield* db.run(SQLite.deleteFrom(schema.channelBotsTable).allRows())
	if (payload.bots.length > 0) {
		yield* db.run(
			SQLite.insertInto(schema.channelBotsTable).values(payload.bots.map((bot) => ({ ...bot }))),
		)
	}

	yield* writeObjectMeta(CHANNEL_ORG_KEY, payload.organizationId)
	if (payload.conversationId === null) yield* deleteObjectMeta(CHANNEL_CONVERSATION_KEY)
	else yield* writeObjectMeta(CHANNEL_CONVERSATION_KEY, payload.conversationId)
	yield* Effect.annotateCurrentSpan({
		"channel.viewers": payload.viewers.length,
		"channel.viewers_removed": removed.length,
		"channel.viewers_added": added.length,
		"channel.viewers_changed": changed.length,
	})
})

export const channelReceivers = {
	"channel.setViewers": setViewers,
} satisfies EffectReceivers<typeof ChannelEffects, Database.Database | SqlClient>
