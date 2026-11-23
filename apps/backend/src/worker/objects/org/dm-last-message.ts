/**
 * A DM's newest message on its `channels` row (`lastMessageAt`, `lastMessageAuthorId`,
 * `lastMessagePreview`), so the DM list shows who said what and when, as Slack's does.
 *
 * The org already holds every message's text in its search index (`./message-search.ts`), fed on
 * create, edit and delete; after each change to a DM's index the row is recomputed from the
 * index's newest row, so an edit or a deleted last message updates it too. Only DMs (`single`,
 * `direct`): their rows reach only their members, where a public channel's would reach the whole
 * org on every message. DMs older than the columns are filled once when the object activates.
 */
import { Database, SQLite, schema } from "@hazel/db"
import type { ChannelId, UserId } from "@hazel/schema"
import { Effect, Option } from "effect"
import { readObjectMeta, writeObjectMeta } from "../meta"

/** How much of the message the row keeps: a row shows two lines at most. */
export const DM_PREVIEW_MAX = 160

const FILL_KEY = "dmLastMessageVersion"
const FILL_VERSION = "1"

const isDm = (type: string) => type === "single" || type === "direct"

/** At most `max` code points, so an emoji or a surrogate pair is never cut in half. */
export const dmPreviewOf = (searchText: string): string | null => {
	const text = searchText.replace(/\s+/g, " ").trim()
	if (text === "") return null
	const points = Array.from(text)
	return points.length <= DM_PREVIEW_MAX
		? text
		: `${points
				.slice(0, DM_PREVIEW_MAX - 1)
				.join("")
				.trimEnd()}…`
}

/** Recompute the DM's last message from the search index; a no-op for any other channel. */
export const refreshDmLastMessage = Effect.fn("OrgObject.refreshDmLastMessage")(function* (
	channelId: ChannelId,
) {
	const db = yield* Database.Database
	const channel = yield* db.first(
		SQLite.from(schema.channelsTable)
			.select("type", "lastMessageAt", "lastMessageAuthorId", "lastMessagePreview")
			.where(($) => [$.id.eq(channelId)])
			.limit(1),
	)
	if (Option.isNone(channel) || !isDm(channel.value.type)) return
	const newest = yield* db.first(
		SQLite.from(schema.messageSearchTable)
			.select("authorId", "createdAt", "content")
			.where(($) => [$.channelId.eq(channelId)])
			.orderBy(($) => [[$.createdAt, "desc"]])
			.limit(1),
	)
	const next: {
		readonly lastMessageAt: Date | null
		readonly lastMessageAuthorId: UserId | null
		readonly lastMessagePreview: string | null
	} = Option.match(newest, {
		onNone: () => ({ lastMessageAt: null, lastMessageAuthorId: null, lastMessagePreview: null }),
		onSome: (row) => ({
			lastMessageAt: new Date(row.createdAt),
			lastMessageAuthorId: row.authorId,
			lastMessagePreview: dmPreviewOf(row.content),
		}),
	})
	const current = channel.value
	// An unchanged row is not written: each write is a change every member's client receives.
	if (
		current.lastMessageAt?.getTime() === next.lastMessageAt?.getTime() &&
		current.lastMessageAuthorId === next.lastMessageAuthorId &&
		current.lastMessagePreview === next.lastMessagePreview
	)
		return
	yield* db.run(
		SQLite.update(schema.channelsTable)
			.set(next)
			.where(($) => [$.id.eq(channelId)]),
	)
})

/** Once per object: fill the DMs that predate the columns from the index. */
export const fillDmLastMessages = (): Effect.Effect<void, Database.DatabaseError, Database.Database> =>
	Effect.gen(function* () {
		if (Option.getOrUndefined(yield* readObjectMeta(FILL_KEY)) === FILL_VERSION) return
		const db = yield* Database.Database
		const dms = yield* db.run(
			SQLite.from(schema.channelsTable)
				.select("id")
				.where(($) => [
					$.type.in_("single", "direct"),
					$.deletedAt.isNull(),
					$.lastMessageAt.isNull(),
				]),
		)
		yield* Effect.forEach(dms, (dm) => refreshDmLastMessage(dm.id), { discard: true })
		yield* writeObjectMeta(FILL_KEY, FILL_VERSION)
	}).pipe(Effect.withSpan("OrgObject.fillDmLastMessages"))
