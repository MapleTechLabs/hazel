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
 *   message from the index.
 */
import { Database, SQLite, schema } from "@hazel/db"
import type { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Clock, Effect, Option } from "effect"
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

/** Now, or the newest of the channels' messages if that is later (a clock behind the message's). */
const readUpTo = (channelIds: ReadonlyArray<ChannelId>) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const now = new Date(yield* Clock.currentTimeMillis)
		if (channelIds.length === 0) return now
		const newest = yield* db.first(
			SQLite.from(schema.channelActivityTable)
				.select("lastMessageAt")
				.where(($) => [$.channelId.in_(...channelIds)])
				.orderBy(($) => [[$.lastMessageAt, "desc"]])
				.limit(1),
		)
		return Option.match(newest, {
			onNone: () => now,
			onSome: (row) => (row.lastMessageAt > now ? row.lastMessageAt : now),
		})
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
	const lastReadAt = yield* readUpTo(channelIds)
	for (const channelId of channelIds) {
		yield* db.run(
			SQLite.insertInto(schema.channelReadStateTable)
				.values({ channelId, userId, organizationId, lastReadAt })
				.onConflictDoUpdate({
					target: ["channelId", "userId"],
					set: SQLite.excluded(["lastReadAt"]),
				}),
		)
	}
	yield* db.run(
		SQLite.update(schema.channelMembersTable)
			.set({ notificationCount: 0 })
			.where(($) => [$.userId.eq(userId), $.channelId.in_(...channelIds), $.notificationCount.gt(0)]),
	)
	yield* Effect.annotateCurrentSpan({ "read.channels": channelIds.length })
})

/** Once per object: start unread state now, then fill each channel's newest message from the index. */
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
		const channels = yield* db.run(
			SQLite.from(schema.channelsTable)
				.select("id")
				.where(($) => [$.deletedAt.isNull()]),
		)
		yield* Effect.forEach(channels, (channel) => refreshChannelActivity(channel.id), { discard: true })
		yield* writeObjectMeta(FILL_KEY, FILL_VERSION)
	},
).pipe(Effect.withSpan("OrgObject.fillChannelActivity"))
