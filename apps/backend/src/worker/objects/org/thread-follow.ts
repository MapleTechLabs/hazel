/**
 * Discord's thread following: a thread notifies its members (`channel_members` of the thread), so
 * writing in it follows it, and a mention brings the person mentioned in, as long as they are in
 * the parent channel. Either follows again after leaving (Unfollow is `channelMember.delete`), as a
 * mention does in Discord. A thread's access is its parent's (`./channel-access.ts`), so membership changes none.
 */
import { Database, SQLite, schema } from "@hazel/db"
import type { ChannelId, UserId } from "@hazel/schema"
import { Array, Clock, Effect, Option } from "effect"

/** The thread's members now include `authorId` and the mentioned members of its parent channel. */
export const followThread = Effect.fn("OrgObject.followThread")(function* (input: {
	readonly threadId: ChannelId
	readonly parentChannelId: ChannelId
	readonly authorId: UserId
	readonly mentionedUserIds: ReadonlyArray<UserId>
}) {
	const db = yield* Database.Database
	const mentioned = Array.dedupe(input.mentionedUserIds.filter((userId) => userId !== input.authorId))
	// The mentioned must already be in the parent; the author wrote here, so they can see it.
	const inParent =
		mentioned.length === 0
			? []
			: yield* db.run(
					SQLite.from(schema.channelMembersTable)
						.select("userId")
						.where(($) => [
							$.channelId.eq(input.parentChannelId),
							$.userId.in_(...mentioned),
							$.deletedAt.isNull(),
						]),
				)
	const followers = [input.authorId, ...inParent.map((row) => row.userId)]
	const now = new Date(yield* Clock.currentTimeMillis)
	let joined = 0
	for (const userId of followers) {
		const existing = yield* db.first(
			SQLite.from(schema.channelMembersTable)
				.select("id", "deletedAt")
				.where(($) => [$.channelId.eq(input.threadId), $.userId.eq(userId)])
				.limit(1),
		)
		if (Option.isSome(existing)) {
			if (existing.value.deletedAt !== null) {
				yield* db.run(
					SQLite.update(schema.channelMembersTable)
						.set({ deletedAt: null, isHidden: false, joinedAt: now })
						.where(($) => [$.id.eq(existing.value.id)]),
				)
				joined++
			}
			continue
		}
		yield* db.run(
			SQLite.insertInto(schema.channelMembersTable).values({
				channelId: input.threadId,
				userId,
				isHidden: false,
				isMuted: false,
				isFavorite: false,
				lastSeenMessageId: null,
				notificationCount: 0,
				joinedAt: now,
				deletedAt: null,
			}),
		)
		joined++
	}
	yield* Effect.annotateCurrentSpan({ "thread.followers.joined": joined })
})
