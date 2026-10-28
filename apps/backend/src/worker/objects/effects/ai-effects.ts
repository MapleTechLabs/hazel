/**
 * Model calls a `ChannelObject` makes from its own outbox (`ai` target): run in the sender after
 * the commit, never inside a transaction. Enqueued with a delay, so the alarm makes the call and
 * the RPC that asked for it does not wait on it.
 *
 * `ai.nameThread`: name a thread from its original message and first replies (`ThreadNamer`),
 * then rename it in its `OrgObject` (`org.renameChannel`, inbox key from `requestId`).
 */
import { Database, SQLite, schema } from "@hazel/db"
import { ChannelId, OrganizationId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import type { SqlClient } from "effect/sql/SqlClient"
import { ThreadNamer, type ThreadLine } from "../../../services/thread-namer"
import { readThreadOrigin } from "../channel/thread"
import { ChannelRenameEffects } from "../org/channel-rename"
import { ObjectStubs } from "../protocol"
import { defineEffect, type EffectReceivers } from "./registry"

export const NameThreadPayload = Schema.Struct({
	organizationId: OrganizationId,
	threadChannelId: ChannelId,
	/** Unique per request: the rename's inbox key. */
	requestId: Schema.String,
	/** Rename only while the thread still has this name (the automatic run); null always does. */
	onlyIfName: Schema.NullOr(Schema.String),
})
export type NameThreadPayload = typeof NameThreadPayload.Type

export const AiEffects = {
	nameThread: defineEffect("ai.nameThread", "ai", NameThreadPayload),
}

/** Wait before the alarm names the thread (the write's own drain skips it). */
export const AI_EFFECT_DELAY_MS = 1_000

/** The name threads get when they are created. */
export const DEFAULT_THREAD_NAME = "Thread"

const REPLIES_FOR_NAMING = 10

class ThreadRenameRejectedError extends Schema.TaggedError<ThreadRenameRejectedError>()(
	"ThreadRenameRejectedError",
	{ message: Schema.String },
) {}

const nameThread = Effect.fn("AiEffects.nameThread")(function* (payload: NameThreadPayload) {
	const db = yield* Database.Database
	const origin = yield* readThreadOrigin
	const replies = yield* db.run(
		SQLite.from(schema.messagesTable)
			.select("authorId", "content")
			.where(($) => [$.channelId.eq(payload.threadChannelId), $.deletedAt.isNull()])
			.orderBy(($) => [[$.createdAt, "asc"]])
			.limit(REPLIES_FOR_NAMING),
	)

	// The object holds no profiles: authors are told apart, not named.
	const labels = new Map<string, string>()
	const label = (authorId: string) => {
		const known = labels.get(authorId)
		if (known !== undefined) return known
		const next = `Participant ${labels.size + 1}`
		labels.set(authorId, next)
		return next
	}
	const original: ThreadLine | null = Option.match(origin, {
		onNone: () => null,
		onSome: (message) => ({ author: label(message.authorId), content: message.content }),
	})
	const lines = replies.map((reply) => ({ author: label(reply.authorId), content: reply.content }))
	yield* Effect.annotateCurrentSpan({
		"thread.id": payload.threadChannelId,
		"thread.replies": lines.length,
		"thread.has_origin": original !== null,
	})

	const name = yield* (yield* ThreadNamer).name({ original, replies: lines })
	if (Option.isNone(name)) return

	const kind = ChannelRenameEffects.renameChannel
	const rename = yield* Schema.encodeEffect(kind.payload)({
		channelId: payload.threadChannelId,
		name: name.value,
		onlyIfName: payload.onlyIfName,
	})
	const result = yield* (yield* ObjectStubs).get({ kind: "org", id: payload.organizationId }).applyEffect({
		objectId: payload.organizationId,
		kind: kind.name,
		payload: rename,
		key: `ai.nameThread:${payload.requestId}`,
	})
	if (result._tag === "Rejected") {
		return yield* new ThreadRenameRejectedError({ message: result.message })
	}
})

export const aiReceivers = {
	"ai.nameThread": nameThread,
} satisfies EffectReceivers<typeof AiEffects, Database.Database | SqlClient | ThreadNamer | ObjectStubs>
