/**
 * `org.renameChannel`: a channel's name set by another object, today a thread named by its
 * `ChannelObject` (`../effects/ai-effects.ts`). `onlyIfName` keeps a name a person chose since.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { ChannelId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { defineEffect } from "../effects/registry"

export const RenameChannelPayload = Schema.Struct({
	channelId: ChannelId,
	name: Schema.String,
	/** Rename only while the channel still has this name; null renames unconditionally. */
	onlyIfName: Schema.NullOr(Schema.String),
})
export type RenameChannelPayload = typeof RenameChannelPayload.Type

export const ChannelRenameEffects = {
	renameChannel: defineEffect("org.renameChannel", "org", RenameChannelPayload),
}

export const renameChannel = Effect.fn("OrgEffects.renameChannel")(function* (payload: RenameChannelPayload) {
	const db = yield* Database.Database
	const renamed = yield* db.run(
		SQLite.update(schema.channelsTable)
			.set({ name: payload.name, updatedAt: new Date() })
			.where(($) => [
				$.id.eq(payload.channelId),
				$.deletedAt.isNull(),
				...(payload.onlyIfName === null ? [] : [$.name.eq(payload.onlyIfName)]),
			])
			.returning("id"),
	)
	yield* Effect.annotateCurrentSpan({
		"channel.id": payload.channelId,
		"channel.renamed": renamed.length > 0,
	})
})

export const channelRenameReceivers = {
	"org.renameChannel": renameChannel,
}
