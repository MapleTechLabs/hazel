import {
	ChannelMemberRepo,
	ChannelRepo,
	MessageRepo,
	OrganizationMemberRepo,
	UserRepo,
} from "@hazel/backend-core"
import { Database, SQLite, schema } from "@hazel/db"
import {
	CurrentUser,
	DmChannelAlreadyExistsError,
	ErrorUtils,
	InternalServerError,
	InvalidChannelRequestError,
	withRemapDbErrors,
} from "@hazel/domain"
import { type ChannelId, OrganizationId, type UserId } from "@hazel/schema"
import { ChannelNotFoundError, ChannelResponse, ChannelRpcs, MessageNotFoundError } from "@hazel/domain/rpc"
import { Effect, Option } from "effect"
import { generateTransactionId } from "../../lib/create-transactionId"
import { ChannelPolicy } from "../../policies/channel-policy"
import { UserPolicy } from "../../policies/user-policy"
import { BotGatewayEffects } from "../../worker/objects/effects/bot-gateway-effects"
import { ChannelEffects } from "../../worker/objects/effects/channel-effects"
import { enqueueEffect } from "../../worker/objects/effects/registry"
import { channelTarget } from "../../worker/objects/kinds"
import { syncChannelAccess, syncChannelTree } from "../../worker/objects/org/channel-access"
import { ChannelViewers } from "../../services/channel-viewers"
import { Directory } from "../../services/directory"
import { requestThreadName } from "../../worker/objects/channel/message-events"
import { readThreadOrigin } from "../../worker/objects/channel/thread"

/**
 * Channel RPC handlers. Run in the channel's `OrgObject` (`rpc/routing.ts`), except
 * `channel.generateName` (the thread's `ChannelObject`).
 *
 * Every write recomputes `channel_access` org-locally and projects it (`syncChannelAccess` /
 * `syncChannelTree`: `setViewers` to the channel's `ChannelObject`, its `channel_index` row);
 * bots get `channel.*` events from the outbox. `channel.createThread` links the parent message in
 * the parent's `ChannelObject` (`channel.setThreadChannel`).
 */
export const ChannelRpcLive = ChannelRpcs.toLayer(
	Effect.gen(function* () {
		const db = yield* Database.Database
		const channelMemberRepo = yield* ChannelMemberRepo
		const channelPolicy = yield* ChannelPolicy
		const userPolicy = yield* UserPolicy
		const messageRepo = yield* MessageRepo
		const channelRepo = yield* ChannelRepo
		const organizationMemberRepo = yield* OrganizationMemberRepo
		const userRepo = yield* UserRepo
		const directory = yield* Directory

		/**
		 * A client-chosen channel id must be new everywhere: an id another org's channel holds
		 * would otherwise be routed to that channel's object (`channel_index`).
		 */
		const requireUnusedChannelId = Effect.fn("ChannelRpc.requireUnusedChannelId")(function* (
			id: ChannelId,
		) {
			const indexed = yield* directory.channel(id)
			if (Option.isSome(indexed)) {
				return yield* new InvalidChannelRequestError({ message: "The channel id is already taken" })
			}
		})

		/** The installed bots hear about it after the commit (outbox). */
		const channelEvent = (
			eventType: "channel.create" | "channel.update" | "channel.delete",
			channel: ChannelResponse["data"],
		) => enqueueEffect(BotGatewayEffects.channelEvent, { kind: "bot-gateway" }, { eventType, channel })

		const addMember = (channelId: ChannelId, userId: UserId) =>
			channelMemberRepo.insert({
				channelId,
				userId,
				isHidden: false,
				isMuted: false,
				isFavorite: false,
				lastSeenMessageId: null,
				notificationCount: 0,
				joinedAt: new Date(),
				deletedAt: null,
			})

		return {
			"channel.create": ({ id, addAllMembers, ...payload }) =>
				db
					.transaction(
						Effect.gen(function* () {
							const user = yield* CurrentUser.Context

							const insertData = id
								? { id, ...payload, deletedAt: null }
								: { ...payload, deletedAt: null }

							yield* channelPolicy.canCreate(payload.organizationId)
							if (id) yield* requireUnusedChannelId(id)
							const createdChannel = yield* channelRepo
								.insert(insertData as typeof payload & { deletedAt: null })
								.pipe(Effect.map((res) => res[0]!))

							yield* addMember(createdChannel.id, user.id)

							if (addAllMembers) {
								const orgMembers = yield* organizationMemberRepo.findAllByOrganization(
									payload.organizationId,
								)
								yield* Effect.forEach(
									orgMembers.filter((m) => m.userId !== user.id),
									(member) => addMember(createdChannel.id, member.userId),
									{ discard: true },
								)
							}

							// Recompute access, then project it to the new ChannelObject and the
							// directory's channel_index (outbox; delivered right after the commit).
							yield* syncChannelAccess(createdChannel.id)
							yield* channelEvent("channel.create", createdChannel)

							const txid = yield* generateTransactionId()

							return new ChannelResponse({
								data: createdChannel,
								transactionId: txid,
							})
						}),
					)
					.pipe(withRemapDbErrors("Channel", "create")),

			"channel.update": ({ id, ...payload }) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* channelPolicy.canUpdate(id)
							const updatedChannel = yield* channelRepo.update({
								id,
								...payload,
							})

							// A type change moves its readers, and its threads' with it.
							yield* syncChannelTree(id)
							yield* channelEvent("channel.update", updatedChannel)

							const txid = yield* generateTransactionId()

							return new ChannelResponse({
								data: updatedChannel,
								transactionId: txid,
							})
						}),
					)
					.pipe(withRemapDbErrors("Channel", "update")),

			"channel.delete": ({ id }) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* channelPolicy.canDelete(id)
							const existing = yield* channelRepo.findById(id)
							// Soft delete: the row stays so its projection (no viewers, an index row
							// marked deleted) can say so; its threads lose their readers with it.
							yield* db.run(
								SQLite.update(schema.channelsTable)
									.set({ deletedAt: new Date() })
									.where(($) => [$.id.eq(id), $.deletedAt.isNull()]),
							)
							yield* syncChannelTree(id)
							if (Option.isSome(existing)) yield* channelEvent("channel.delete", existing.value)

							const txid = yield* generateTransactionId()

							return { transactionId: txid }
						}),
					)
					.pipe(withRemapDbErrors("Channel", "delete")),

			"channel.createDm": (payload) =>
				db
					.transaction(
						Effect.gen(function* () {
							const user = yield* CurrentUser.Context
							const organizationId = OrganizationId.make(payload.organizationId)

							if (payload.type === "single" && payload.participantIds.length !== 1) {
								return yield* new InvalidChannelRequestError({
									message: "DM channels must have exactly one other participant",
								})
							}

							if (payload.type === "single") {
								const existingChannel = yield* channelMemberRepo.findExistingSingleDmChannel(
									user.id,
									payload.participantIds[0],
									organizationId,
								)
								if (Option.isSome(existingChannel)) {
									return yield* new DmChannelAlreadyExistsError({
										message: "A direct message channel already exists with this user",
										detail: `Channel ID: ${existingChannel.value.id}`,
									})
								}
							}

							// Name single DMs after both people (the org's `users` projection).
							let channelName = payload.name
							if (payload.type === "single") {
								yield* userPolicy.canRead(payload.participantIds[0]!)
								const otherUser = yield* userRepo.findById(payload.participantIds[0])
								const currentUser = yield* userRepo.findById(user.id)
								if (Option.isSome(otherUser) && Option.isSome(currentUser)) {
									const names = [
										`${currentUser.value.firstName} ${currentUser.value.lastName}`.trim(),
										`${otherUser.value.firstName} ${otherUser.value.lastName}`.trim(),
									].sort()
									channelName = names.join(", ")
								}
							}

							yield* channelPolicy.canCreate(organizationId)
							const createdChannel = yield* channelRepo
								.insert({
									name: channelName || "Group Channel",
									icon: null,
									type: payload.type,
									organizationId,
									parentChannelId: null,
									sectionId: null,
									deletedAt: null,
								})
								.pipe(Effect.map((res) => res[0]!))

							yield* addMember(createdChannel.id, user.id)
							for (const participantId of new Set(payload.participantIds)) {
								if (participantId !== user.id)
									yield* addMember(createdChannel.id, participantId)
							}

							yield* syncChannelAccess(createdChannel.id)
							yield* channelEvent("channel.create", createdChannel)

							const txid = yield* generateTransactionId()

							return new ChannelResponse({
								data: createdChannel,
								transactionId: txid,
							})
						}),
					)
					.pipe(withRemapDbErrors("Channel", "create")),

			"channel.createThread": ({
				id,
				messageId,
				organizationId: requestedOrganizationId,
				channelId: parentChannelId,
			}) =>
				db
					.transaction(
						Effect.gen(function* () {
							const user = yield* CurrentUser.Context

							// The message lives in the parent's ChannelObject; the client names its
							// channel. The parent's link is set there, through the outbox.
							if (parentChannelId === undefined) {
								return yield* new InvalidChannelRequestError({
									message: "channel.createThread needs the message's `channelId`",
								})
							}
							const parentChannel = yield* channelRepo.findById(parentChannelId)
							if (Option.isNone(parentChannel) || parentChannel.value.deletedAt !== null) {
								return yield* new InternalServerError({
									message: "Parent channel for message was not found",
									detail: `messageId=${messageId} parentChannelId=${parentChannelId}`,
								})
							}

							// A message inside a thread replies in that thread.
							if (parentChannel.value.type === "thread") {
								yield* channelPolicy.canCreate(parentChannel.value.organizationId)
								return new ChannelResponse({
									data: parentChannel.value,
									transactionId: yield* generateTransactionId(),
								})
							}

							const organizationId = parentChannel.value.organizationId
							if (requestedOrganizationId && requestedOrganizationId !== organizationId) {
								return yield* new InvalidChannelRequestError({
									message: "The thread's organization does not match the message's",
								})
							}

							yield* channelPolicy.canCreate(organizationId)

							// A retried create (same client-chosen id) returns the thread it made.
							if (id !== undefined) {
								const existing = yield* channelRepo.findById(id)
								if (Option.isSome(existing)) {
									if (
										existing.value.type !== "thread" ||
										existing.value.parentChannelId !== parentChannelId
									) {
										return yield* new InvalidChannelRequestError({
											message: "The thread id is taken by another channel",
										})
									}
									return new ChannelResponse({
										data: existing.value,
										transactionId: yield* generateTransactionId(),
									})
								}
								yield* requireUnusedChannelId(id)
							}

							const createdChannel = yield* channelRepo
								.insert({
									...(id === undefined ? {} : { id }),
									name: "Thread",
									icon: null,
									type: "thread" as const,
									organizationId,
									parentChannelId,
									sectionId: null,
									deletedAt: null,
								} as never)
								.pipe(Effect.map((res) => res[0]!))

							yield* addMember(createdChannel.id, user.id)
							yield* syncChannelAccess(createdChannel.id)
							// First link wins in the parent (two racing creates leave one orphan).
							yield* enqueueEffect(
								ChannelEffects.setThreadChannel,
								channelTarget(parentChannelId),
								{
									messageId,
									threadChannelId: createdChannel.id,
								},
							)

							const txid = yield* generateTransactionId()

							return new ChannelResponse({
								data: createdChannel,
								transactionId: txid,
							})
						}),
					)
					.pipe(withRemapDbErrors("Channel", "create")),

			"channel.generateName": ({ channelId }) =>
				Effect.gen(function* () {
					// Runs in the thread's `ChannelObject`: authorized by its viewers, the original
					// message from its thread origin; the alarm names it (`ai.nameThread`).
					const viewers = yield* ChannelViewers.make
					yield* ErrorUtils.refailUnauthorized(
						"Channel",
						"update",
					)(viewers.require(channelId, "channels:write"))
					const origin = yield* readThreadOrigin.pipe(
						withRemapDbErrors("Channel", "select", channelId),
					)
					if (Option.isNone(origin)) {
						return yield* new InvalidChannelRequestError({
							message: "Only threads with an original message can be named",
						})
					}
					const organizationId = yield* viewers.organizationId.pipe(
						withRemapDbErrors("Channel", "select", channelId),
					)
					if (Option.isNone(organizationId)) {
						return yield* new ChannelNotFoundError({ channelId })
					}
					yield* db.transaction(requestThreadName(organizationId.value, channelId, null)).pipe(
						Effect.catchTag("SchemaError", (error) => Effect.die(error)),
						withRemapDbErrors("Channel", "update", channelId),
					)
					return { success: true }
				}).pipe(Effect.withSpan("Channel.generateName", { attributes: { "channel.id": channelId } })),
		}
	}),
)
