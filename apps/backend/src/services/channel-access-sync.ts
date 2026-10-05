import { and, eq, isNull, notInArray, schema } from "@hazel/db"
import type { ChannelId, ConnectConversationId, OrganizationId, UserId } from "@hazel/schema"
import { Context, Effect, Layer } from "effect"
import { transactionAwareExecute } from "../lib/transaction-aware-execute"

export class ChannelAccessSyncService extends Context.Service<ChannelAccessSyncService>()(
	"ChannelAccessSyncService",
	{
		make: Effect.gen(function* () {
			const upsertChannelUsers = Effect.fn("ChannelAccessSyncService.upsertChannelUsers")(function* (
				channelId: ChannelId,
				organizationId: OrganizationId,
				userIds: readonly UserId[],
			) {
				const dedupedUserIds = [...new Set(userIds)].sort()
				if (dedupedUserIds.length === 0) {
					yield* transactionAwareExecute((client) =>
						client
							.delete(schema.channelAccessTable)
							.where(eq(schema.channelAccessTable.channelId, channelId)),
					)
					return
				}

				yield* transactionAwareExecute((client) =>
					client
						.insert(schema.channelAccessTable)
						.values(
							dedupedUserIds.map((userId) => ({
								userId,
								channelId,
								organizationId,
							})),
						)
						.onConflictDoUpdate({
							target: [schema.channelAccessTable.userId, schema.channelAccessTable.channelId],
							set: {
								organizationId,
								updatedAt: new Date(),
							},
						}),
				)

				yield* transactionAwareExecute((client) =>
					client
						.delete(schema.channelAccessTable)
						.where(
							and(
								eq(schema.channelAccessTable.channelId, channelId),
								notInArray(schema.channelAccessTable.userId, dedupedUserIds),
							),
						),
				)
			})

			const removeChannel = Effect.fn("ChannelAccessSyncService.removeChannel")(function* (
				channelId: ChannelId,
			) {
				yield* transactionAwareExecute((client) =>
					client
						.delete(schema.channelAccessTable)
						.where(eq(schema.channelAccessTable.channelId, channelId)),
				)
			})

			const syncChannel = Effect.fn("ChannelAccessSyncService.syncChannel")(function* (
				channelId: ChannelId,
			) {
				const channels = yield* transactionAwareExecute((client) =>
					client
						.select({
							id: schema.channelsTable.id,
							type: schema.channelsTable.type,
							organizationId: schema.channelsTable.organizationId,
							parentChannelId: schema.channelsTable.parentChannelId,
						})
						.from(schema.channelsTable)
						.where(
							and(
								eq(schema.channelsTable.id, channelId),
								isNull(schema.channelsTable.deletedAt),
							),
						)
						.limit(1),
				)

				const channel = channels[0]
				if (!channel) {
					yield* removeChannel(channelId)
					return
				}

				let userIds: readonly UserId[] = []

				if (channel.type === "public") {
					const members = yield* transactionAwareExecute((client) =>
						client
							.select({ userId: schema.organizationMembersTable.userId })
							.from(schema.organizationMembersTable)
							.where(
								and(
									eq(
										schema.organizationMembersTable.organizationId,
										channel.organizationId,
									),
									isNull(schema.organizationMembersTable.deletedAt),
								),
							),
					)
					userIds = members.map((row) => row.userId)
				} else if (
					channel.type === "private" ||
					channel.type === "direct" ||
					channel.type === "single"
				) {
					const members = yield* transactionAwareExecute((client) =>
						client
							.select({ userId: schema.channelMembersTable.userId })
							.from(schema.channelMembersTable)
							.innerJoin(
								schema.organizationMembersTable,
								and(
									eq(
										schema.organizationMembersTable.organizationId,
										channel.organizationId,
									),
									eq(
										schema.organizationMembersTable.userId,
										schema.channelMembersTable.userId,
									),
									isNull(schema.organizationMembersTable.deletedAt),
								),
							)
							.where(
								and(
									eq(schema.channelMembersTable.channelId, channel.id),
									isNull(schema.channelMembersTable.deletedAt),
								),
							),
					)
					userIds = members.map((row) => row.userId)
				} else if (channel.type === "thread") {
					if (!channel.parentChannelId) {
						yield* upsertChannelUsers(channel.id, channel.organizationId, [])
						return
					}
					const parentChannelId = channel.parentChannelId

					const parentAccess = yield* transactionAwareExecute((client) =>
						client
							.select({ userId: schema.channelAccessTable.userId })
							.from(schema.channelAccessTable)
							.innerJoin(
								schema.organizationMembersTable,
								and(
									eq(
										schema.organizationMembersTable.organizationId,
										channel.organizationId,
									),
									eq(
										schema.organizationMembersTable.userId,
										schema.channelAccessTable.userId,
									),
									isNull(schema.organizationMembersTable.deletedAt),
								),
							)
							.where(
								and(
									eq(schema.channelAccessTable.channelId, parentChannelId),
									eq(schema.channelAccessTable.organizationId, channel.organizationId),
								),
							),
					)
					userIds = parentAccess.map((row) => row.userId)
				}

				// If channel is part of a connect conversation, add cross-org participants
				const connectMount = yield* transactionAwareExecute((client) =>
					client
						.select({
							conversationId: schema.connectConversationChannelsTable.conversationId,
						})
						.from(schema.connectConversationChannelsTable)
						.where(
							and(
								eq(schema.connectConversationChannelsTable.channelId, channelId),
								isNull(schema.connectConversationChannelsTable.deletedAt),
							),
						)
						.limit(1),
				)

				if (connectMount[0]) {
					const participants = yield* transactionAwareExecute((client) =>
						client
							.select({ userId: schema.connectParticipantsTable.userId })
							.from(schema.connectParticipantsTable)
							.where(
								and(
									eq(
										schema.connectParticipantsTable.conversationId,
										connectMount[0].conversationId,
									),
									isNull(schema.connectParticipantsTable.deletedAt),
								),
							),
					)
					userIds = [...userIds, ...participants.map((p) => p.userId)]
				}

				yield* upsertChannelUsers(channel.id, channel.organizationId, userIds)
			})

			const syncConversation = Effect.fn("ChannelAccessSyncService.syncConversation")(function* (
				conversationId: ConnectConversationId,
			) {
				const mounts = yield* transactionAwareExecute((client) =>
					client
						.select({ channelId: schema.connectConversationChannelsTable.channelId })
						.from(schema.connectConversationChannelsTable)
						.where(
							and(
								eq(schema.connectConversationChannelsTable.conversationId, conversationId),
								isNull(schema.connectConversationChannelsTable.deletedAt),
							),
						),
				)

				yield* Effect.forEach(mounts, (mount) => syncChannel(mount.channelId), {
					concurrency: 10,
				})
			})

			const syncChildThreads = Effect.fn("ChannelAccessSyncService.syncChildThreads")(function* (
				parentChannelId: ChannelId,
			) {
				const childThreads = yield* transactionAwareExecute((client) =>
					client
						.select({ id: schema.channelsTable.id })
						.from(schema.channelsTable)
						.where(
							and(
								eq(schema.channelsTable.parentChannelId, parentChannelId),
								eq(schema.channelsTable.type, "thread"),
								isNull(schema.channelsTable.deletedAt),
							),
						),
				)

				yield* Effect.forEach(childThreads, (thread) => syncChannel(thread.id), { concurrency: 10 })
			})

			const syncUserInOrganization = Effect.fn("ChannelAccessSyncService.syncUserInOrganization")(
				function* (userId: UserId, organizationId: OrganizationId) {
					const activeMembership = yield* transactionAwareExecute((client) =>
						client
							.select({ id: schema.organizationMembersTable.id })
							.from(schema.organizationMembersTable)
							.where(
								and(
									eq(schema.organizationMembersTable.organizationId, organizationId),
									eq(schema.organizationMembersTable.userId, userId),
									isNull(schema.organizationMembersTable.deletedAt),
								),
							)
							.limit(1),
					)

					if (activeMembership.length === 0) {
						yield* transactionAwareExecute((client) =>
							client
								.delete(schema.channelAccessTable)
								.where(
									and(
										eq(schema.channelAccessTable.userId, userId),
										eq(schema.channelAccessTable.organizationId, organizationId),
									),
								),
						)
						return
					}

					const channels = yield* transactionAwareExecute((client) =>
						client
							.select({
								id: schema.channelsTable.id,
								type: schema.channelsTable.type,
								parentChannelId: schema.channelsTable.parentChannelId,
							})
							.from(schema.channelsTable)
							.where(
								and(
									eq(schema.channelsTable.organizationId, organizationId),
									isNull(schema.channelsTable.deletedAt),
								),
							),
					)

					const membershipChannels = yield* transactionAwareExecute((client) =>
						client
							.select({ channelId: schema.channelMembersTable.channelId })
							.from(schema.channelMembersTable)
							.innerJoin(
								schema.channelsTable,
								and(
									eq(schema.channelsTable.id, schema.channelMembersTable.channelId),
									eq(schema.channelsTable.organizationId, organizationId),
									isNull(schema.channelsTable.deletedAt),
								),
							)
							.where(
								and(
									eq(schema.channelMembersTable.userId, userId),
									isNull(schema.channelMembersTable.deletedAt),
								),
							),
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
						yield* transactionAwareExecute((client) =>
							client
								.delete(schema.channelAccessTable)
								.where(
									and(
										eq(schema.channelAccessTable.userId, userId),
										eq(schema.channelAccessTable.organizationId, organizationId),
									),
								),
						)
						return
					}

					yield* transactionAwareExecute((client) =>
						client
							.insert(schema.channelAccessTable)
							.values(
								desiredChannelIds.map((channelId) => ({
									userId,
									channelId,
									organizationId,
								})),
							)
							.onConflictDoUpdate({
								target: [
									schema.channelAccessTable.userId,
									schema.channelAccessTable.channelId,
								],
								set: {
									organizationId,
									updatedAt: new Date(),
								},
							}),
					)

					yield* transactionAwareExecute((client) =>
						client
							.delete(schema.channelAccessTable)
							.where(
								and(
									eq(schema.channelAccessTable.userId, userId),
									eq(schema.channelAccessTable.organizationId, organizationId),
									notInArray(schema.channelAccessTable.channelId, desiredChannelIds),
								),
							),
					)
				},
			)

			return {
				syncChannel,
				syncConversation,
				syncChildThreads,
				syncUserInOrganization,
				removeChannel,
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
