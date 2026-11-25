/**
 * Unread state (`packages/db/src/tables/channel-activity.ts`): a member's channel is unread while
 * its newest message (`channel_activity`) is someone else's and newer than their read position
 * (`channel_read_state`).
 *
 * - The newest message is kept like a DM's last message (`./dm-last-message.ts`): recomputed from
 *   the search index (`./message-search.ts`) after each change to a channel's rows there, so an
 *   edit or a deleted newest message moves it too. An unchanged row is not written, since every
 *   write reaches the channel's members. Without the index (its migration failed) nothing is unread.
 * - The read position moves when the member reads the channel (`markChannelRead`); only they see it.
 * - Objects older than the tables are filled once when they activate: `readStateSince` is set
 *   (every member is read up to then, one write, safe to repeat), then each channel's newest
 *   message from the index, in one grouped read.
 */
import { Database, SQLite, schema } from "@hazel/db"
import type { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Array as Arr, Clock, Effect, Option } from "effect"
import { inList, rowsPerInsert } from "../customers/sql"
import { readObjectMeta, writeObjectMeta } from "../meta"

const FILL_KEY = "channelActivityVersion"
const FILL_VERSION = "1"

/** Recompute the channel's newest message from the search index. */
export const refreshChannelActivity = Effect.fn("OrgObject.refreshChannelActivity")(function* (
	channelId: ChannelId,
) {
	const db = yield* Database.Database
	const channel = yield* db.first(
		SQLite.from(schema.channelsTable)
			.select("organizationId")
			.where(($) => [$.id.eq(channelId)])
			.limit(1),
	)
	if (Option.isNone(channel)) return
	const newest = yield* db.first(
		SQLite.from(schema.messageSearchTable)
			.select("messageId", "authorId", "createdAt")
			.where(($) => [$.channelId.eq(channelId)])
			.orderBy(($) => [[$.createdAt, "desc"]])
			.limit(1),
	)
	const current = yield* db.first(
		SQLite.from(schema.channelActivityTable)
			.select("lastMessageId")
			.where(($) => [$.channelId.eq(channelId)])
			.limit(1),
	)
	if (Option.isNone(newest)) {
		if (Option.isSome(current)) {
			yield* db.run(
				SQLite.deleteFrom(schema.channelActivityTable).where(($) => [$.channelId.eq(channelId)]),
			)
		}
		return
	}
	if (Option.isSome(current) && current.value.lastMessageId === newest.value.messageId) return
	const row = {
		channelId,
		organizationId: channel.value.organizationId,
		lastMessageId: newest.value.messageId,
		lastMessageAt: new Date(newest.value.createdAt),
		lastMessageAuthorId: newest.value.authorId,
	}
	yield* db.run(
		SQLite.insertInto(schema.channelActivityTable)
			.values(row)
			.onConflictDoUpdate({ target: ["channelId"], set: SQLite.excludedAll() }),
	)
})

/** The read position for each channel: now, or its newest message if that is later (a clock behind the message's). */
const readUpTo = (channelIds: ReadonlyArray<ChannelId>) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const now = new Date(yield* Clock.currentTimeMillis)
		const rows = yield* db.run(
			SQLite.from(schema.channelActivityTable)
				.select("channelId", "lastMessageAt")
				.where(($) => [inList($.channelId, channelIds)]),
		)
		const newest = new Map(rows.map((row) => [row.channelId, row.lastMessageAt]))
		return (channelId: ChannelId): Date => {
			const at = newest.get(channelId)
			return at !== undefined && at > now ? at : now
		}
	})

/**
 * The member read these channels: their read position moves to now, and their unread mention count
 * goes to 0 where it is not already (a `channel_members` write reaches every member of the channel,
 * so an unchanged one is not made).
 */
export const markChannelsRead = Effect.fn("OrgObject.markChannelsRead")(function* (
	organizationId: OrganizationId,
	userId: UserId,
	channelIds: ReadonlyArray<ChannelId>,
) {
	if (channelIds.length === 0) return
	const db = yield* Database.Database
	const lastReadAtOf = yield* readUpTo(channelIds)
	const rows = channelIds.map((channelId) => ({
		channelId,
		userId,
		organizationId,
		lastReadAt: lastReadAtOf(channelId),
	}))
	for (const chunk of Arr.chunksOf(rows, rowsPerInsert(4))) {
		yield* db.run(
			SQLite.insertInto(schema.channelReadStateTable)
				.values(chunk)
				.onConflictDoUpdate({
					target: ["channelId", "userId"],
					set: SQLite.excluded(["lastReadAt"]),
				}),
		)
	}
	yield* db.run(
		SQLite.update(schema.channelMembersTable)
			.set({ notificationCount: 0 })
			.where(($) => [$.userId.eq(userId), inList($.channelId, channelIds), $.notificationCount.gt(0)]),
	)
	yield* Effect.annotateCurrentSpan({ "read.channels": channelIds.length })
})

/**
 * Once per object: start unread state now, then fill the newest message of each channel that has
 * no `channel_activity` row yet. One grouped read over the index (`message_search_channel_created_idx`
 * answers it per channel), then chunked inserts; a row already there is kept (it is live). Safe to
 * run again: a fill cut short repeats only what it did not write.
 */
export const fillChannelActivity: Effect.Effect<void, Database.DatabaseError, Database.Database> = Effect.gen(
	function* () {
		if (Option.getOrUndefined(yield* readObjectMeta(FILL_KEY)) === FILL_VERSION) return
		const db = yield* Database.Database
		const now = new Date(yield* Clock.currentTimeMillis)
		// Only where unset: a fill that failed after this and runs again keeps the first time.
		yield* db.run(
			SQLite.update(schema.organizationsTable)
				.set({ readStateSince: now })
				.where(($) => [$.readStateSince.isNull()]),
		)
		const heads = SQLite.from(schema.messageSearchTable)
			.select(($) => ({ channelId: $.channelId, newest: SQLite.max($.createdAt) }))
			.groupBy("channelId")
		const newest = yield* db.run(
			SQLite.from(schema.messageSearchTable, "s")
				.innerJoinQuery(heads, "h", (s, h) =>
					SQLite.and(s.channelId.eq(h.channelId), s.createdAt.eq(h.newest)),
				)
				.innerJoin(schema.channelsTable, "c", (s, c) =>
					SQLite.and(c.id.eq(s.channelId), c.deletedAt.isNull()),
				)
				.select(($) => ({
					channelId: $.channelId,
					organizationId: $.c.organizationId,
					messageId: $.messageId,
					authorId: $.authorId,
					createdAt: $.createdAt,
				}))
				.where(($) => [
					SQLite.not(
						SQLite.exists(
							SQLite.from(schema.channelActivityTable)
								.select(() => ({ one: SQLite.lit(1) }))
								.where((a) => [a.channelId.eq($.channelId)]),
						),
					),
				]),
		)
		// Two messages at the same millisecond: either is the newest.
		const rows = [...new Map(newest.map((row) => [row.channelId, row])).values()].map((row) => ({
			channelId: row.channelId,
			organizationId: row.organizationId,
			lastMessageId: row.messageId,
			lastMessageAt: new Date(row.createdAt),
			lastMessageAuthorId: row.authorId,
		}))
		for (const chunk of Arr.chunksOf(rows, rowsPerInsert(5))) {
			yield* db.run(SQLite.insertInto(schema.channelActivityTable).values(chunk).onConflictDoNothing())
		}
		yield* Effect.annotateCurrentSpan({ "fill.channels": rows.length })
		yield* writeObjectMeta(FILL_KEY, FILL_VERSION)
	},
).pipe(Effect.withSpan("OrgObject.fillChannelActivity"))
