import {
	ChannelRepo,
	ConnectParticipantRepo,
	ConnectConversationChannelRepo,
	ConnectConversationRepo,
	MessageReactionRepo,
	MessageRepo,
} from "@hazel/backend-core"
import { InternalServerError } from "@hazel/domain"
import type { ChannelId, ConnectConversationId, OrganizationId, UserId } from "@hazel/schema"
import { Context, Effect, Layer, Option } from "effect"
import { ChannelAccessSyncService } from "./channel-access-sync"
import { OrgResolver } from "./org-resolver"

export class ConnectConversationService extends Context.Service<ConnectConversationService>()(
	"ConnectConversationService",
	{
		make: Effect.gen(function* () {
			const channelRepo = yield* ChannelRepo
			const connectParticipantRepo = yield* ConnectParticipantRepo
			const connectConversationRepo = yield* ConnectConversationRepo
			const connectConversationChannelRepo = yield* ConnectConversationChannelRepo
			const messageRepo = yield* MessageRepo
			const messageReactionRepo = yield* MessageReactionRepo
			const channelAccessSync = yield* ChannelAccessSyncService
			const orgResolver = yield* OrgResolver

			const isUniqueViolation = (error: any, constraintName: string) =>
				error?.type === "unique_violation" && error?.cause?.constraint_name === constraintName

			const getHostConversationOrFail = (channelId: ChannelId) =>
				connectConversationRepo.findByHostChannel(channelId).pipe(
					Effect.flatMap(
						Option.match({
							onNone: () =>
								Effect.fail(
									new InternalServerError({
										message: "Hazel Connect conversation missing after unique conflict",
										detail: `channelId=${channelId}`,
									}),
								),
							onSome: Effect.succeed,
						}),
					),
				)

			const getMountOrFail = (channelId: ChannelId) =>
				connectConversationChannelRepo.findByChannelId(channelId).pipe(
					Effect.flatMap(
						Option.match({
							onNone: () =>
								Effect.fail(
									new InternalServerError({
										message: "Hazel Connect mount missing after unique conflict",
										detail: `channelId=${channelId}`,
									}),
								),
							onSome: Effect.succeed,
						}),
					),
				)

			const ensureChannelConversation = Effect.fn(
				"connectConversationService.ensureChannelConversation",
			)(function* (channelId: ChannelId, createdBy: UserId) {
				const existingMount = yield* connectConversationChannelRepo.findByChannelId(channelId)
				if (Option.isSome(existingMount)) {
					return existingMount.value
				}

				const channelOption = yield* channelRepo.findById(channelId)
				if (Option.isNone(channelOption)) {
					return yield* Effect.fail(
						new InternalServerError({
							message: "Cannot create conversation for missing channel",
							detail: `channelId=${channelId}`,
						}),
					)
				}

				const channel = channelOption.value
				const conversation = yield* connectConversationRepo
					.insert({
						hostOrganizationId: channel.organizationId,
						hostChannelId: channel.id,
						status: "active",
						settings: null,
						createdBy,
						deletedAt: null,
					})
					.pipe(
						Effect.map((results) => results[0]!),
						Effect.catchTag("DatabaseError", (error) => {
							if (!isUniqueViolation(error, "connect_conversations_host_channel_unique")) {
								return Effect.fail(error)
							}
							return getHostConversationOrFail(channel.id)
						}),
					)

				const mount = yield* connectConversationChannelRepo
					.insert({
						conversationId: conversation.id,
						organizationId: channel.organizationId,
						channelId: channel.id,
						role: "host",
						allowGuestMemberAdds: false,
						isActive: true,
						deletedAt: null,
					})
					.pipe(
						Effect.map((results) => results[0]!),
						Effect.catchTag("DatabaseError", (error) => {
							if (
								!isUniqueViolation(error, "connect_conv_channels_channel_unique") &&
								!isUniqueViolation(error, "connect_conv_channels_conversation_org_unique")
							) {
								return Effect.fail(error)
							}
							return getMountOrFail(channel.id)
						}),
					)

				yield* messageRepo.backfillConversationIdForChannel(channel.id, conversation.id)
				yield* messageReactionRepo.backfillConversationIdForChannel(channel.id, conversation.id)

				return mount
			})

			const getConversationIdForChannel = Effect.fn(
				"connectConversationService.getConversationIdForChannel",
			)(function* (channelId: ChannelId) {
				const mount = yield* connectConversationChannelRepo.findByChannelId(channelId)
				if (Option.isSome(mount)) {
					return mount.value.conversationId
				}
				return yield* Effect.succeed(null as ConnectConversationId | null)
			})

			const listMountedChannels = Effect.fn("ConnectConversationService.listMountedChannels")(
				function* (conversationId: ConnectConversationId) {
					return yield* connectConversationChannelRepo.findByConversationId(conversationId)
				},
			)

			const getMountForChannel = Effect.fn("ConnectConversationService.getMountForChannel")(function* (
				channelId: ChannelId,
			) {
				return yield* connectConversationChannelRepo.findByChannelId(channelId)
			})

			const canAccessConversation = Effect.fn("ConnectConversationService.canAccessConversation")(
				function* (
					conversationId: ConnectConversationId,
					scope: Parameters<typeof orgResolver.fromChannelWithAccess>[1],
				) {
					const mounts = yield* connectConversationChannelRepo.findByConversationId(conversationId)
					for (const mount of mounts) {
						const attempt = yield* orgResolver
							.fromChannelWithAccess(mount.channelId, scope, "ConnectConversation", "read")
							.pipe(Effect.result)
						if (attempt._tag === "Success") {
							return true
						}
					}
					return false
				},
			)

			const addParticipantToConversation = Effect.fn(
				"connectConversationService.addParticipantToConversation",
			)(function* (
				conversationId: ConnectConversationId,
				userId: UserId,
				homeOrganizationId: OrganizationId,
				addedBy: UserId,
			) {
				yield* addParticipantsToConversation(
					conversationId,
					[{ userId, homeOrganizationId }],
					addedBy,
				)
			})

			const addParticipantsToConversation = Effect.fn(
				"connectConversationService.addParticipantsToConversation",
			)(function* (
				conversationId: ConnectConversationId,
				participants: ReadonlyArray<{
					userId: UserId
					homeOrganizationId: OrganizationId
				}>,
				addedBy: UserId,
			) {
				const mounts = yield* connectConversationChannelRepo.findByConversationId(conversationId)
				const rows = mounts.flatMap((mount) =>
					participants.map((participant) => ({
						conversationId,
						channelId: mount.channelId,
						userId: participant.userId,
						homeOrganizationId: participant.homeOrganizationId,
						isExternal: mount.organizationId !== participant.homeOrganizationId,
						addedBy,
						deletedAt: null as Date | null,
					})),
				)

				yield* Effect.forEach(rows, (row) => connectParticipantRepo.upsertByChannelAndUser(row), {
					concurrency: 10,
				})
			})

			const removeParticipantFromConversation = Effect.fn(
				"connectConversationService.removeParticipantFromConversation",
			)(function* (conversationId: ConnectConversationId, userId: UserId) {
				const participants = yield* connectParticipantRepo.listByConversation(conversationId)
				const mounts = yield* connectConversationChannelRepo.findByConversationId(conversationId)

				yield* Effect.forEach(
					participants.filter((participant) => participant.userId === userId),
					(participant) =>
						connectParticipantRepo.update({
							id: participant.id,
							deletedAt: new Date(),
						}),
					{ concurrency: 10 },
				)

				yield* Effect.forEach(mounts, (mount) => channelAccessSync.syncChannel(mount.channelId), {
					concurrency: 10,
				})
			})

			const disconnectOrganization = Effect.fn("ConnectConversationService.disconnectOrganization")(
				function* (conversationId: ConnectConversationId, organizationId: OrganizationId) {
					const conversationOption = yield* connectConversationRepo.findById(conversationId)
					if (Option.isNone(conversationOption)) {
						return yield* Effect.fail(
							new InternalServerError({
								message: "Hazel Connect conversation not found",
								detail: `conversationId=${conversationId}`,
							}),
						)
					}

					const conversation = conversationOption.value
					const mounts = yield* connectConversationChannelRepo.findByConversationId(conversationId)
					const targetMount =
						mounts.find((mount) => mount.organizationId === organizationId) ?? null
					const participants = yield* connectParticipantRepo.listByConversation(conversationId)

					if (organizationId === conversation.hostOrganizationId) {
						yield* Effect.forEach(
							mounts,
							(mount) =>
								connectConversationChannelRepo.update({
									id: mount.id,
									isActive: false,
									deletedAt: new Date(),
								}),
							{ concurrency: 10 },
						)
						yield* Effect.forEach(
							participants,
							(participant) =>
								connectParticipantRepo.update({
									id: participant.id,
									deletedAt: new Date(),
								}),
							{ concurrency: 10 },
						)
						yield* connectConversationRepo.update({
							id: conversationId,
							status: "disconnected",
							deletedAt: new Date(),
						})
						yield* Effect.forEach(
							mounts,
							(mount) => channelAccessSync.syncChannel(mount.channelId),
							{ concurrency: 10 },
						)
						return
					}

					if (targetMount) {
						yield* connectConversationChannelRepo.update({
							id: targetMount.id,
							isActive: false,
							deletedAt: new Date(),
						})
					}

					yield* Effect.forEach(
						participants.filter(
							(participant) => participant.homeOrganizationId === organizationId,
						),
						(participant) =>
							connectParticipantRepo.update({
								id: participant.id,
								deletedAt: new Date(),
							}),
						{ concurrency: 10 },
					)

					yield* Effect.forEach(mounts, (mount) => channelAccessSync.syncChannel(mount.channelId), {
						concurrency: 10,
					})
				},
			)

			return {
				ensureChannelConversation,
				getConversationIdForChannel,
				getMountForChannel,
				listMountedChannels,
				canAccessConversation,
				addParticipantToConversation,
				addParticipantsToConversation,
				removeParticipantFromConversation,
				disconnectOrganization,
			} as const
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(ChannelRepo.layer),
		Layer.provide(ConnectParticipantRepo.layer),
		Layer.provide(ConnectConversationRepo.layer),
		Layer.provide(ConnectConversationChannelRepo.layer),
		Layer.provide(MessageRepo.layer),
		Layer.provide(MessageReactionRepo.layer),
		Layer.provide(ChannelAccessSyncService.layer),
		Layer.provide(OrgResolver.layer),
	)
}
