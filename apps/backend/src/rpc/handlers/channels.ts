import { HttpApiClient } from "effect/http-api"
import {
	ChannelMemberRepo,
	ChannelRepo,
	MessageRepo,
	OrganizationMemberRepo,
	UserRepo,
} from "@hazel/backend-core"
import { Database, schema } from "@hazel/db"
import {
	Cluster,
	CurrentUser,
	DmChannelAlreadyExistsError,
	InternalServerError,
	withRemapDbErrors,
	WorkflowServiceUnavailableError,
} from "@hazel/domain"
import { OrganizationId } from "@hazel/schema"
import { ChannelNotFoundError, ChannelResponse, ChannelRpcs, MessageNotFoundError } from "@hazel/domain/rpc"
import { eq } from "drizzle-orm"
import { Config, Effect, Option } from "effect"
import { generateTransactionId } from "../../lib/create-transactionId"
import { transactionAwareExecute } from "../../lib/transaction-aware-execute"
import { ChannelPolicy } from "../../policies/channel-policy"
import { UserPolicy } from "../../policies/user-policy"
import { BotGatewayService } from "../../services/bot-gateway-service"
import { ChannelAccessSyncService } from "../../services/channel-access-sync"

export const ChannelRpcLive = ChannelRpcs.toLayer(
	Effect.gen(function* () {
		const db = yield* Database.Database
		const botGateway = yield* BotGatewayService
		const channelMemberRepo = yield* ChannelMemberRepo
		const channelPolicy = yield* ChannelPolicy
		const userPolicy = yield* UserPolicy
		const messageRepo = yield* MessageRepo
		const channelRepo = yield* ChannelRepo
		const organizationMemberRepo = yield* OrganizationMemberRepo
		const userRepo = yield* UserRepo
		const channelAccessSync = yield* ChannelAccessSyncService

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
							const createdChannel = yield* channelRepo
								.insert(insertData as typeof payload & { deletedAt: null })
								.pipe(Effect.map((res) => res[0]!))

							yield* channelMemberRepo.insert({
								channelId: createdChannel.id,
								userId: user.id,
								isHidden: false,
								isMuted: false,
								isFavorite: false,
								lastSeenMessageId: null,
								notificationCount: 0,
								joinedAt: new Date(),
								deletedAt: null,
							})

							if (addAllMembers) {
								const orgMembers = yield* organizationMemberRepo.findAllByOrganization(
									payload.organizationId,
								)

								yield* Effect.forEach(
									orgMembers.filter((m) => m.userId !== user.id),
									(member) =>
										channelMemberRepo.insert({
											channelId: createdChannel.id,
											userId: member.userId,
											isHidden: false,
											isMuted: false,
											isFavorite: false,
											lastSeenMessageId: null,
											notificationCount: 0,
											joinedAt: new Date(),
											deletedAt: null,
										}),
									{ concurrency: 10 },
								)
							}

							yield* channelAccessSync.syncChannel(createdChannel.id)

							const txid = yield* generateTransactionId()

							return new ChannelResponse({
								data: createdChannel,
								transactionId: txid,
							})
						}),
					)
					.pipe(
						withRemapDbErrors("Channel", "create"),
						Effect.tap((response) =>
							botGateway.publishChannelEvent("channel.create", response.data).pipe(
								Effect.catchTag("DurableStreamRequestError", (error) =>
									Effect.logWarning("Failed to publish channel.create to bot gateway", {
										error,
										channelId: response.data.id,
									}),
								),
							),
						),
					),

			"channel.update": ({ id, ...payload }) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* channelPolicy.canUpdate(id)
							const updatedChannel = yield* channelRepo.update({
								id,
								...payload,
							})

							yield* channelAccessSync.syncChannel(id)
							yield* channelAccessSync.syncChildThreads(id)

							const txid = yield* generateTransactionId()

							return new ChannelResponse({
								data: updatedChannel,
								transactionId: txid,
							})
						}),
					)
					.pipe(
						withRemapDbErrors("Channel", "update"),
						Effect.tap((response) =>
							botGateway.publishChannelEvent("channel.update", response.data).pipe(
								Effect.catchTag("DurableStreamRequestError", (error) =>
									Effect.logWarning("Failed to publish channel.update to bot gateway", {
										error,
										channelId: response.data.id,
									}),
								),
							),
						),
					),

			"channel.delete": ({ id }) =>
				Effect.gen(function* () {
					const existingChannel = yield* channelRepo
						.findById(id)
						.pipe(withRemapDbErrors("Channel", "select"))
					const response = yield* db
						.transaction(
							Effect.gen(function* () {
								yield* channelPolicy.canDelete(id)
								yield* channelRepo.deleteById(id)
								yield* channelAccessSync.removeChannel(id)
								yield* channelAccessSync.syncChildThreads(id)

								const txid = yield* generateTransactionId()

								return { transactionId: txid }
							}),
						)
						.pipe(withRemapDbErrors("Channel", "delete"))

					if (Option.isSome(existingChannel)) {
						yield* botGateway.publishChannelEvent("channel.delete", existingChannel.value).pipe(
							Effect.catchTag("DurableStreamRequestError", (error) =>
								Effect.logWarning("Failed to publish channel.delete to bot gateway", {
									error,
									channelId: existingChannel.value.id,
								}),
							),
						)
					}

					return response
				}),

			"channel.createDm": (payload) =>
				db
					.transaction(
						Effect.gen(function* () {
							const user = yield* CurrentUser.Context

							// Validate participant count for single DMs
							if (payload.type === "single" && payload.participantIds.length !== 1) {
								return yield* Effect.fail(
									new InternalServerError({
										message: "DM channels must have exactly one other participant",
										cause: "Invalid participant count",
									}),
								)
							}

							// Check for existing DM channel
							if (payload.type === "single") {
								const existingChannel = yield* channelMemberRepo.findExistingSingleDmChannel(
									user.id,
									payload.participantIds[0],
									OrganizationId.make(payload.organizationId),
								)

								if (Option.isSome(existingChannel)) {
									return yield* Effect.fail(
										new DmChannelAlreadyExistsError({
											message: "A direct message channel already exists with this user",
											detail: `Channel ID: ${existingChannel.value.id}`,
										}),
									)
								}
							}

							// Generate channel name for DMs
							let channelName = payload.name
							if (payload.type === "single") {
								yield* userPolicy.canRead(payload.participantIds[0]!)
								const otherUser = yield* userRepo.findById(payload.participantIds[0])
								const currentUser = yield* userRepo.findById(user.id)

								if (Option.isSome(otherUser) && Option.isSome(currentUser)) {
									// Create a consistent name for DMs using first and last name
									const currentUserName =
										`${currentUser.value.firstName} ${currentUser.value.lastName}`.trim()
									const otherUserName =
										`${otherUser.value.firstName} ${otherUser.value.lastName}`.trim()
									const names = [currentUserName, otherUserName].sort()
									channelName = names.join(", ")
								}
							}

							// Create channel
							yield* channelPolicy.canCreate(OrganizationId.make(payload.organizationId))
							const createdChannel = yield* channelRepo
								.insert({
									name: channelName || "Group Channel",
									icon: null,
									type: payload.type,
									organizationId: OrganizationId.make(payload.organizationId),
									parentChannelId: null,
									sectionId: null,
									deletedAt: null,
								})
								.pipe(Effect.map((res) => res[0]!))

							// Add creator as member
							yield* channelMemberRepo.insert({
								channelId: createdChannel.id,
								userId: user.id,
								isHidden: false,
								isMuted: false,
								isFavorite: false,
								lastSeenMessageId: null,
								notificationCount: 0,
								joinedAt: new Date(),
								deletedAt: null,
							})

							// Add all participants as members
							for (const participantId of payload.participantIds) {
								yield* channelMemberRepo.insert({
									channelId: createdChannel.id,
									userId: participantId,
									isHidden: false,
									isMuted: false,
									isFavorite: false,
									lastSeenMessageId: null,
									notificationCount: 0,
									joinedAt: new Date(),
									deletedAt: null,
								})
							}

							yield* channelAccessSync.syncChannel(createdChannel.id)

							const txid = yield* generateTransactionId()

							return new ChannelResponse({
								data: createdChannel,
								transactionId: txid,
							})
						}),
					)
					.pipe(
						withRemapDbErrors("Channel", "create"),
						Effect.tap((response) =>
							botGateway.publishChannelEvent("channel.create", response.data).pipe(
								Effect.catchTag("DurableStreamRequestError", (error) =>
									Effect.logWarning("Failed to publish channel.create DM to bot gateway", {
										error,
										channelId: response.data.id,
									}),
								),
							),
						),
					),

			"channel.createThread": ({ id, messageId, organizationId: requestedOrganizationId }) =>
				db
					.transaction(
						Effect.gen(function* () {
							const user = yield* CurrentUser.Context

							// 1. Find the message and resolve thread context from authoritative DB data
							const message = yield* messageRepo.findById(messageId)

							if (Option.isNone(message)) {
								return yield* Effect.fail(new MessageNotFoundError({ messageId }))
							}

							// If the message already points to a thread, return that thread.
							if (message.value.threadChannelId) {
								const existingThread = yield* channelRepo.findById(
									message.value.threadChannelId,
								)
								if (Option.isNone(existingThread)) {
									return yield* Effect.fail(
										new InternalServerError({
											message: "Thread channel linked to message was not found",
											detail: `messageId=${messageId} threadChannelId=${message.value.threadChannelId}`,
										}),
									)
								}

								yield* channelAccessSync.syncChannel(existingThread.value.id)

								const txid = yield* generateTransactionId()
								return new ChannelResponse({
									data: existingThread.value,
									transactionId: txid,
								})
							}

							const parentChannel = yield* channelRepo.findById(message.value.channelId)
							if (Option.isNone(parentChannel)) {
								return yield* Effect.fail(
									new InternalServerError({
										message: "Parent channel for message was not found",
										detail: `messageId=${messageId} parentChannelId=${message.value.channelId}`,
									}),
								)
							}

							// If the message is already in a thread channel, return that thread.
							if (parentChannel.value.type === "thread") {
								yield* channelAccessSync.syncChannel(parentChannel.value.id)

								const txid = yield* generateTransactionId()
								return new ChannelResponse({
									data: parentChannel.value,
									transactionId: txid,
								})
							}

							// Derive organization from parent channel (source of truth).
							const organizationId = parentChannel.value.organizationId

							// Optional client org must match the derived parent channel org.
							if (requestedOrganizationId && requestedOrganizationId !== organizationId) {
								return yield* Effect.fail(
									new InternalServerError({
										message: "Thread creation organization mismatch",
										detail: `messageId=${messageId} parentOrganizationId=${organizationId} requestedOrganizationId=${requestedOrganizationId}`,
									}),
								)
							}

							// 2. Create thread channel only when no existing thread was resolved
							const insertData = id
								? {
										id,
										name: "Thread",
										icon: null,
										type: "thread" as const,
										organizationId,
										parentChannelId: parentChannel.value.id,
										sectionId: null,
										deletedAt: null,
									}
								: {
										name: "Thread",
										icon: null,
										type: "thread" as const,
										organizationId,
										parentChannelId: parentChannel.value.id,
										sectionId: null,
										deletedAt: null,
									}

							yield* channelPolicy.canCreate(organizationId)
							const createdChannel = yield* channelRepo
								.insert(insertData)
								.pipe(Effect.map((res) => res[0]!))

							// 3. Add creator as member
							yield* channelMemberRepo.insert({
								channelId: createdChannel.id,
								userId: user.id,
								isHidden: false,
								isMuted: false,
								isFavorite: false,
								lastSeenMessageId: null,
								notificationCount: 0,
								joinedAt: new Date(),
								deletedAt: null,
							})

							// 4. Link message to thread (direct SQL update to bypass schema restrictions)
							yield* transactionAwareExecute((client) =>
								client
									.update(schema.messagesTable)
									.set({ threadChannelId: createdChannel.id })
									.where(eq(schema.messagesTable.id, messageId)),
							)

							yield* channelAccessSync.syncChannel(createdChannel.id)

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
					yield* channelPolicy.canUpdate(channelId)

					const channel = yield* channelRepo.findById(channelId).pipe(
						Effect.catchTag("DatabaseError", (err) =>
							Effect.fail(
								new InternalServerError({
									message: "Failed to query channel",
									cause: String(err),
								}),
							),
						),
					)

					if (Option.isNone(channel)) {
						return yield* Effect.fail(new ChannelNotFoundError({ channelId }))
					}

					if (channel.value.type !== "thread") {
						return yield* Effect.fail(
							new InternalServerError({
								message: "Channel is not a thread",
								cause: `Channel type: ${channel.value.type}`,
							}),
						)
					}

					const originalMessageResult = yield* transactionAwareExecute((client) =>
						client
							.select({ id: schema.messagesTable.id })
							.from(schema.messagesTable)
							.where(eq(schema.messagesTable.threadChannelId, channelId))
							.limit(1),
					).pipe(Effect.catchTag("DatabaseError", () => Effect.succeed([])))

					if (originalMessageResult.length === 0) {
						return yield* Effect.fail(
							new MessageNotFoundError({
								messageId:
									channelId as unknown as typeof schema.messagesTable.$inferSelect.id,
							}),
						)
					}

					const originalMessageId = originalMessageResult[0]!.id

					const clusterUrl = yield* Config.String("CLUSTER_URL").pipe(
						Effect.mapError(
							() =>
								new WorkflowServiceUnavailableError({
									message: "CLUSTER_URL not configured",
									cause: "Missing CLUSTER_URL environment variable",
								}),
						),
					)
					const client = yield* HttpApiClient.make(Cluster.WorkflowApi, {
						baseUrl: clusterUrl,
					})

					yield* client.workflows
						.ThreadNamingWorkflow({
							payload: {
								threadChannelId: channelId,
								originalMessageId,
							},
						})
						.pipe(
							Effect.tapError((err) =>
								Effect.logError("Failed to execute thread naming workflow", {
									threadChannelId: channelId,
									error: String(err),
									errorTag: "_tag" in err ? err._tag : "unknown",
								}),
							),
							// Workflow errors (ThreadChannelNotFoundError, AIProviderUnavailableError, etc.)
							// pass through directly since they're in the RPC union - only handle HTTP client errors
							Effect.catchTag("HttpClientError", (err) =>
								Effect.fail(
									new WorkflowServiceUnavailableError({
										message: "Cannot connect to workflow service",
										cause: String(err),
									}),
								),
							),
							Effect.catchTag("SchemaError", (err) =>
								Effect.fail(
									new InternalServerError({
										message: "Failed to parse workflow response",
										cause: String(err),
									}),
								),
							),
						)

					yield* Effect.logDebug("Triggered thread naming workflow", {
						threadChannelId: channelId,
						originalMessageId,
					})

					return {
						success: true,
					}
				}),
		}
	}),
)
