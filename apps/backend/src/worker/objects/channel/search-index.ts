/**
 * A `ChannelObject`'s part in its org's message search (`../org/message-search.ts`): each message
 * write sends `org.indexMessages` (`./message-events.ts`), and a backfill request
 * (`channel.exportSearchMessages`) is answered with one page of the channel's messages, through
 * the same outbox, so pages and live writes reach the org in the order they happened here.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { DateTime, Effect, Option } from "effect"
import { CHANNEL_ORG_KEY } from "../effects/channel-effects"
import { CurrentEffectSender, enqueueEffect } from "../effects/registry"
import { orgTarget } from "../kinds"
import { readObjectMeta } from "../meta"
import { type ExportSearchMessagesPayload, type IndexedMessage, SearchOrgEffects } from "../search-wire"

/** Messages per backfill page. */
export const SEARCH_EXPORT_PAGE_SIZE = 200

const millis = (value: Date | DateTime.Utc) =>
	value instanceof Date ? value.getTime() : DateTime.toEpochMillis(value)

export const toIndexedMessage = (message: {
	readonly id: IndexedMessage["id"]
	readonly authorId: IndexedMessage["authorId"]
	readonly conversationId?: IndexedMessage["conversationId"] | undefined
	readonly createdAt: Date | DateTime.Utc
	readonly content: string
}): IndexedMessage => ({
	id: message.id,
	authorId: message.authorId,
	conversationId: message.conversationId ?? null,
	createdAt: millis(message.createdAt),
	content: message.content,
})

/**
 * One page after `after`, sent back to the asking org. A channel no org has claimed yet holds no
 * messages anyone wrote: it answers an empty last page, so the backfill does not wait on it.
 */
export const exportSearchMessages = Effect.fn("ChannelObject.exportSearchMessages")(function* (
	payload: ExportSearchMessagesPayload,
) {
	const sender = yield* Effect.serviceOption(CurrentEffectSender)
	if (Option.isNone(sender) || sender.value.kind !== "org") return
	const organizationId = sender.value.id
	const pinned = yield* readObjectMeta(CHANNEL_ORG_KEY)
	const db = yield* Database.Database
	const after = payload.after
	const rows = Option.isNone(pinned)
		? []
		: yield* db.run(
				SQLite.from(schema.messagesTable)
					.select("id", "authorId", "conversationId", "createdAt", "content")
					.where(($) => [
						$.deletedAt.isNull(),
						after === null
							? undefined
							: SQLite.or(
									$.createdAt.gt(new Date(after.createdAt)),
									SQLite.and($.createdAt.eq(new Date(after.createdAt)), $.id.gt(after.id)),
								),
					])
					.orderBy(($) => [
						[$.createdAt, "asc"],
						[$.id, "asc"],
					])
					.limit(SEARCH_EXPORT_PAGE_SIZE),
			)
	const upsert = rows.map(toIndexedMessage)
	const last = upsert.at(-1)
	yield* enqueueEffect(
		SearchOrgEffects.indexMessages,
		orgTarget(organizationId) as { kind: "org"; id: string },
		{
			upsert,
			remove: [],
			page: {
				generation: payload.generation,
				replace: after === null,
				next:
					last === undefined || upsert.length < SEARCH_EXPORT_PAGE_SIZE
						? null
						: { createdAt: last.createdAt, id: last.id },
				...(payload.guest === undefined ? {} : { guest: payload.guest }),
			},
		},
	)
	yield* Effect.annotateCurrentSpan({ "search.exported": upsert.length })
})
