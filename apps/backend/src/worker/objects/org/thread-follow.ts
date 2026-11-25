/**
 * Discord's thread following: a thread notifies its members (`channel_members` of the thread), so
 * writing in it follows it, and a mention brings the person mentioned in, as long as they are in
 * the parent channel. Unfollow is `channelMember.delete` (the row goes), so either follows again,
 * as a mention does in Discord. Only the organization's own members follow (not Connect guests or
 * bots). A thread's access is its parent's (`./channel-access.ts`), so membership changes none;
 * the installed bots hear `channel_member.add`, as for a join.
 */
import { Database, SQLite, schema } from "@hazel/db"
import type { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Array, Clock, Effect, Option } from "effect"
import { BotGatewayEffects } from "../effects/bot-gateway-effects"
import { enqueueEffect } from "../effects/registry"

/** The thread's members now include `authorId` and the mentioned members of its parent channel. */
export const followThread = Effect.fn("OrgObject.followThread")(function* (input: {
	readonly organizationId: OrganizationId
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
	const candidates = [input.authorId, ...inParent.map((row) => row.userId)]
	const orgMembers = yield* db.run(
		SQLite.from(schema.organizationMembersTable)
			.select("userId")
			.where(($) => [$.userId.in_(...candidates), $.deletedAt.isNull()]),
	)
	const followers = candidates.filter((userId) => orgMembers.some((row) => row.userId === userId))
	const now = new Date(yield* Clock.currentTimeMillis)
	let joined = 0
	for (const userId of followers) {
		const existing = yield* db.first(
			SQLite.from(schema.channelMembersTable)
				.select("id")
				.where(($) => [$.channelId.eq(input.threadId), $.userId.eq(userId), $.deletedAt.isNull()])
				.limit(1),
		)
		if (Option.isSome(existing)) continue
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
		const member = yield* db.first(
			SQLite.from(schema.channelMembersTable)
				.select()
				.where(($) => [$.channelId.eq(input.threadId), $.userId.eq(userId), $.deletedAt.isNull()])
				.limit(1),
		)
		if (Option.isSome(member)) {
			yield* enqueueEffect(
				BotGatewayEffects.channelMemberEvent,
				{ kind: "bot-gateway" },
				{
					organizationId: input.organizationId,
					eventType: "channel_member.add",
					member: member.value,
				},
			)
		}
		joined++
	}
	yield* Effect.annotateCurrentSpan({ "thread.followers.joined": joined })
})
