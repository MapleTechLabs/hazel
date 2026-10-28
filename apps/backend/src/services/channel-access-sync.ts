/**
 * Recomputes `channel_access` from org-local tables. Inside an `OrgObject`, call it through
 * `worker/objects/org/channel-access.ts` (`syncChannelAccess`, `syncChannelTree`, `syncMemberAccess`),
 * which also projects the result. TODO(do-sync): fold into that module and delete this service once
 * bots and chat-sync have moved to those helpers. A Connect host channel's access includes the
 * conversation's participants (`worker/objects/org/connect.ts`).
 */
import { Database, SQLite, schema } from "@hazel/db"
import type { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Context, Effect, Layer } from "effect"

export class ChannelAccessSyncService extends Context.Service<ChannelAccessSyncService>()(
	"ChannelAccessSyncService",
	{
		make: Effect.gen(function* () {
			const db = yield* Database.Database

			const upsertChannelUsers = Effect.fn("ChannelAccessSyncService.upsertChannelUsers")(function* (
				channelId: ChannelId,
				organizationId: OrganizationId,
				userIds: readonly UserId[],
			) {
				const dedupedUserIds = [...new Set(userIds)].sort()
				if (dedupedUserIds.length === 0) {
					yield* db.run(
						SQLite.deleteFrom(schema.channelAccessTable).where(($) => [
							$.channelId.eq(channelId),
						]),
					)
					return
				}

				yield* db.run(
					SQLite.insertInto(schema.channelAccessTable)
						.values(
							dedupedUserIds.map((userId) => ({
								userId,
								channelId,
								organizationId,
							})),
						)
						.onConflictDoUpdate({
							target: ["userId", "channelId"],
							set: {
								organizationId,
								updatedAt: new Date(),
							},
						}),
				)

				yield* db.run(
					SQLite.deleteFrom(schema.channelAccessTable).where(($) => [
						$.channelId.eq(channelId),
						$.userId.notIn(...dedupedUserIds),
					]),
				)
			})

			const removeChannel = Effect.fn("ChannelAccessSyncService.removeChannel")(function* (
				channelId: ChannelId,
			) {
				yield* db.run(
					SQLite.deleteFrom(schema.channelAccessTable).where(($) => [$.channelId.eq(channelId)]),
				)
			})

			const syncChannel = Effect.fn("ChannelAccessSyncService.syncChannel")(function* (
				channelId: ChannelId,
			) {
				const channelOption = yield* db.first(
					SQLite.from(schema.channelsTable)
						.select("id", "type", "organizationId", "parentChannelId")
						.where(($) => [$.id.eq(channelId), $.deletedAt.isNull()])
						.limit(1),
				)

				if (channelOption._tag === "None") {
					yield* removeChannel(channelId)
					return
				}
				const channel = channelOption.value

				let userIds: readonly UserId[] = []

				if (channel.type === "public") {
					const members = yield* db.run(
						SQLite.from(schema.organizationMembersTable)
							.select("userId")
							.where(($) => [
								$.organizationId.eq(channel.organizationId),
								$.deletedAt.isNull(),
							]),
					)
					userIds = members.map((row) => row.userId)
				} else if (
					channel.type === "private" ||
					channel.type === "direct" ||
					channel.type === "single"
				) {
					const members = yield* db.run(
						SQLite.from(schema.channelMembersTable, "cm")
							.innerJoin(schema.organizationMembersTable, "om", (cm, om) =>
								SQLite.and(
									om.organizationId.eq(channel.organizationId),
									om.userId.eq(cm.userId),
									om.deletedAt.isNull(),
								),
							)
							.select(($) => ({ userId: $.userId }))
							.where(($) => [$.channelId.eq(channel.id), $.deletedAt.isNull()]),
					)
					userIds = members.map((row) => row.userId)
				} else if (channel.type === "thread") {
					if (!channel.parentChannelId) {
						yield* upsertChannelUsers(channel.id, channel.organizationId, [])
						return
					}
					const parentChannelId = channel.parentChannelId

					const parentAccess = yield* db.run(
						SQLite.from(schema.channelAccessTable, "ca")
							.innerJoin(schema.organizationMembersTable, "om", (ca, om) =>
								SQLite.and(
									om.organizationId.eq(channel.organizationId),
									om.userId.eq(ca.userId),
									om.deletedAt.isNull(),
								),
							)
							.select(($) => ({ userId: $.userId }))
							.where(($) => [
								$.channelId.eq(parentChannelId),
								$.organizationId.eq(channel.organizationId),
							]),
					)
					userIds = parentAccess.map((row) => row.userId)
				}

				// If channel is part of a connect conversation, add cross-org participants
				const connectMount = yield* db.first(
					SQLite.from(schema.connectConversationChannelsTable)
						.select("conversationId")
						.where(($) => [$.channelId.eq(channelId), $.deletedAt.isNull()])
						.limit(1),
				)

				if (connectMount._tag === "Some") {
					const conversationId = connectMount.value.conversationId
					const participants = yield* db.run(
						SQLite.from(schema.connectParticipantsTable)
							.select("userId")
							.where(($) => [$.conversationId.eq(conversationId), $.deletedAt.isNull()]),
					)
					userIds = [...userIds, ...participants.map((p) => p.userId)]
				}

				yield* upsertChannelUsers(channel.id, channel.organizationId, userIds)
			})

			const syncChildThreads = Effect.fn("ChannelAccessSyncService.syncChildThreads")(function* (
				parentChannelId: ChannelId,
			) {
				const childThreads = yield* db.run(
					SQLite.from(schema.channelsTable)
						.select("id")
						.where(($) => [
							$.parentChannelId.eq(parentChannelId),
							$.type.eq("thread"),
							$.deletedAt.isNull(),
						]),
				)

				yield* Effect.forEach(childThreads, (thread) => syncChannel(thread.id), { concurrency: 10 })
			})

			const syncUserInOrganization = Effect.fn("ChannelAccessSyncService.syncUserInOrganization")(
				function* (userId: UserId, organizationId: OrganizationId) {
					const activeMembership = yield* db.run(
						SQLite.from(schema.organizationMembersTable)
							.select("id")
							.where(($) => [
								$.organizationId.eq(organizationId),
								$.userId.eq(userId),
								$.deletedAt.isNull(),
							])
							.limit(1),
					)

					if (activeMembership.length === 0) {
						yield* db.run(
							SQLite.deleteFrom(schema.channelAccessTable).where(($) => [
								$.userId.eq(userId),
								$.organizationId.eq(organizationId),
							]),
						)
						return
					}

					const channels = yield* db.run(
						SQLite.from(schema.channelsTable)
							.select("id", "type", "parentChannelId")
							.where(($) => [$.organizationId.eq(organizationId), $.deletedAt.isNull()]),
					)

					const membershipChannels = yield* db.run(
						SQLite.from(schema.channelMembersTable, "cm")
							.innerJoin(schema.channelsTable, "c", (cm, c) =>
								SQLite.and(
									c.id.eq(cm.channelId),
									c.organizationId.eq(organizationId),
									c.deletedAt.isNull(),
								),
							)
							.select(($) => ({ channelId: $.channelId }))
							.where(($) => [$.userId.eq(userId), $.deletedAt.isNull()]),
					)

					const baseChannelIds = new Set<ChannelId>(
						channels.filter((channel) => channel.type === "public").map((channel) => channel.id),
					)
					for (const memberChannel of membershipChannels) {
						baseChannelIds.add(memberChannel.channelId)
					}

					const threadChannelIds = channels
						.filter(
							(channel) =>
								channel.type === "thread" &&
								channel.parentChannelId !== null &&
								baseChannelIds.has(channel.parentChannelId),
						)
						.map((channel) => channel.id)

					const desiredChannelIds = [...new Set([...baseChannelIds, ...threadChannelIds])].sort()

					if (desiredChannelIds.length === 0) {
						yield* db.run(
							SQLite.deleteFrom(schema.channelAccessTable).where(($) => [
								$.userId.eq(userId),
								$.organizationId.eq(organizationId),
							]),
						)
						return
					}

					yield* db.run(
						SQLite.insertInto(schema.channelAccessTable)
							.values(
								desiredChannelIds.map((channelId) => ({
									userId,
									channelId,
									organizationId,
								})),
							)
							.onConflictDoUpdate({
								target: ["userId", "channelId"],
								set: {
									organizationId,
									updatedAt: new Date(),
								},
							}),
					)

					yield* db.run(
						SQLite.deleteFrom(schema.channelAccessTable).where(($) => [
							$.userId.eq(userId),
							$.organizationId.eq(organizationId),
							$.channelId.notIn(...desiredChannelIds),
						]),
					)
				},
			)

			return {
				syncChannel,
				syncChildThreads,
				syncUserInOrganization,
				removeChannel,
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
