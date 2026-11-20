/**
 * Chat sync configuration: connections and channel links. Runs in the org's `OrgObject`
 * (`rpc/routing.ts`), which owns both. Each change, inside its transaction, keeps the directory's
 * `chat_sync_index` current (the gateway routes by it) and re-projects the affected channels'
 * links to their `ChannelObject`s (`services/chat-sync/chat-sync-org.ts`).
 */
import {
	ChannelMemberRepo,
	ChannelRepo,
	ChatSyncChannelLinkRepo,
	ChatSyncConnectionRepo,
	IntegrationConnectionRepo,
	OrganizationMemberRepo,
} from "@hazel/backend-core"
import { Database, SQLite, schema } from "@hazel/db"
import {
	type ChannelId,
	ExternalChannelId,
	type OrganizationId,
	type SyncConnectionId,
	type UserId,
} from "@hazel/schema"
import { CurrentUser, InternalServerError, withRemapDbErrors } from "@hazel/domain"
import {
	ChatSyncChannelLinkExistsError,
	ChatSyncChannelLinkListResponse,
	ChatSyncChannelLinkNotFoundError,
	ChatSyncChannelLinkResponse,
	ChatSyncConnectionExistsError,
	ChatSyncIntegrationNotConnectedError,
	ChatSyncConnectionListResponse,
	ChatSyncConnectionNotFoundError,
	ChatSyncConnectionResponse,
	ChatSyncMigrateResponse,
	ChatSyncRpcs,
	ChannelNotFoundError,
	CHAT_SYNC_MIGRATION_MAX_MESSAGES,
	chatSyncHistorySince,
} from "@hazel/domain/rpc"
import { Effect, Option } from "effect"
import { generateTransactionId } from "../../lib/create-transactionId"
import { IntegrationConnectionPolicy } from "../../policies/integration-connection-policy"
import { indexedLinkOwner } from "../../services/chat-sync/chat-sync-index"
import { indexChatSync, publishChatSyncLinks, threadLinksUnder } from "../../services/chat-sync/chat-sync-org"
import {
	type ChatSyncDirection,
	ChatSyncDeliveryEffects,
	ChatSyncHistoryEffects,
} from "../../services/chat-sync/chat-sync-effects"
import { normalizeChannelLinkSettings } from "../../services/chat-sync/chat-sync-settings"
import { isChatSyncProviderId } from "../../services/chat-sync/provider"
import { chatSyncProviders } from "../../services/chat-sync/providers"
import { BotGatewayEffects } from "../../worker/objects/effects/bot-gateway-effects"
import { enqueueEffect } from "../../worker/objects/effects/registry"
import { syncChannelAccess } from "../../worker/objects/org/channel-access"

/** A provider channel's name as a Hazel channel's: trimmed, at most 80 characters, never empty. */
export const migratedChannelName = (name: string): string => name.trim().slice(0, 80) || "imported"

export const ChatSyncRpcLive = ChatSyncRpcs.toLayer(
	Effect.gen(function* () {
		const db = yield* Database.Database
		const connectionRepo = yield* ChatSyncConnectionRepo
		const channelLinkRepo = yield* ChatSyncChannelLinkRepo
		const integrationConnectionRepo = yield* IntegrationConnectionRepo
		const integrationConnectionPolicy = yield* IntegrationConnectionPolicy
		const channelRepo = yield* ChannelRepo
		const channelMemberRepo = yield* ChannelMemberRepo
		const organizationMemberRepo = yield* OrganizationMemberRepo

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

		/**
		 * Saves a link and starts it: the directory index, the channel's projection, the provider's
		 * preparation (Slack joins), and the history import when messages flow into Hazel.
		 */
		const insertLink = Effect.fn("ChatSyncRpc.insertLink")(function* (
			connection: {
				readonly id: SyncConnectionId
				readonly provider: string
				readonly externalWorkspaceId: string
				readonly organizationId: OrganizationId
			},
			input: {
				readonly hazelChannelId: ChannelId
				readonly externalChannelId: ExternalChannelId
				readonly externalChannelName: string | null
				readonly direction: ChatSyncDirection
				readonly settings: Record<string, unknown> | undefined
				readonly history: { readonly remaining: number; readonly since: number | null }
				/** A migration starts its imports itself, as one chain (`importHistory`'s `then`). */
				readonly startsImport?: boolean
			},
		) {
			const [link] = yield* channelLinkRepo.insert({
				syncConnectionId: connection.id,
				hazelChannelId: input.hazelChannelId,
				externalChannelId: input.externalChannelId,
				externalChannelName: input.externalChannelName,
				direction: input.direction,
				isActive: true,
				settings: normalizeChannelLinkSettings(input.settings),
				lastSyncedAt: null,
				deletedAt: null,
			})
			yield* indexChatSync(connection, { link: link!, deleted: false })
			yield* publishChatSyncLinks(link!.hazelChannelId)
			const target = {
				provider: connection.provider,
				externalWorkspaceId: connection.externalWorkspaceId,
				externalChannelId: link!.externalChannelId as ExternalChannelId,
			}
			yield* enqueueEffect(ChatSyncDeliveryEffects.prepareLink, { kind: "chat-sync" }, target)
			if (
				input.startsImport !== false &&
				input.history.remaining > 0 &&
				link!.direction !== "hazel_to_external"
			) {
				yield* enqueueEffect(
					ChatSyncHistoryEffects.importHistory,
					{ kind: "chat-sync" },
					{
						...target,
						remaining: input.history.remaining,
						cursor: null,
						since: input.history.since,
					},
				)
			}
			return link!
		})

		return {
			"chatSync.connection.create": (payload) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* integrationConnectionPolicy.canInsert(payload.organizationId)
							const currentUser = yield* CurrentUser.Context

							// A chat-sync provider needs the org's own connection to it; one whose
							// installs are per workspace (Slack) only to the workspace it installed in,
							// so no org can link (and read) a workspace it does not belong to.
							const integrationConnectionId = yield* Effect.gen(function* () {
								if (!isChatSyncProviderId(payload.provider)) {
									return payload.integrationConnectionId ?? null
								}
								const provider = payload.provider
								const notConnected = new ChatSyncIntegrationNotConnectedError({
									organizationId: payload.organizationId,
									provider,
								})
								const integration = yield* integrationConnectionRepo.findOrgConnection(
									payload.organizationId,
									provider,
								)
								if (Option.isNone(integration) || integration.value.status !== "active") {
									return yield* notConnected
								}
								if (
									chatSyncProviders[provider].workspaceIsInstall &&
									integration.value.externalAccountId !== payload.externalWorkspaceId
								) {
									return yield* notConnected
								}
								return integration.value.id
							})

							const existing = yield* connectionRepo.findByProviderAndWorkspace(
								payload.organizationId,
								payload.provider,
								payload.externalWorkspaceId,
							)
							if (Option.isSome(existing)) {
								return yield* Effect.fail(
									new ChatSyncConnectionExistsError({
										organizationId: payload.organizationId,
										provider: payload.provider,
										externalWorkspaceId: payload.externalWorkspaceId,
									}),
								)
							}

							const [connection] = yield* connectionRepo.insert({
								organizationId: payload.organizationId,
								integrationConnectionId,
								provider: payload.provider,
								externalWorkspaceId: payload.externalWorkspaceId,
								externalWorkspaceName: payload.externalWorkspaceName ?? null,
								status: "active",
								settings: payload.settings ?? null,
								metadata: payload.metadata ?? null,
								errorMessage: null,
								lastSyncedAt: null,
								createdBy: currentUser.id,
								deletedAt: null,
							})
							yield* indexChatSync(connection!, { deleted: false })

							const txid = yield* generateTransactionId()
							return new ChatSyncConnectionResponse({
								data: connection,
								transactionId: txid,
							})
						}),
					)
					.pipe(withRemapDbErrors("ChatSyncConnection", "create")),

			"chatSync.connection.list": ({ organizationId }) =>
				Effect.gen(function* () {
					yield* integrationConnectionPolicy.canSelect(organizationId)
					const data = yield* connectionRepo.findByOrganization(organizationId)
					return new ChatSyncConnectionListResponse({ data })
				}).pipe(withRemapDbErrors("ChatSyncConnection", "select")),

			"chatSync.connection.delete": ({ syncConnectionId }) =>
				db
					.transaction(
						Effect.gen(function* () {
							const connectionOption = yield* connectionRepo.findById(syncConnectionId)
							if (Option.isNone(connectionOption)) {
								return yield* Effect.fail(
									new ChatSyncConnectionNotFoundError({
										syncConnectionId,
									}),
								)
							}
							const connection = connectionOption.value
							yield* integrationConnectionPolicy.canDelete(connection.organizationId)

							yield* connectionRepo.softDelete(syncConnectionId)
							const links = yield* channelLinkRepo.findBySyncConnection(syncConnectionId)
							yield* Effect.forEach(links, (link) => channelLinkRepo.softDelete(link.id), {
								discard: true,
							})
							yield* indexChatSync(connection, { deleted: true })
							yield* Effect.forEach(
								links,
								(link) =>
									indexChatSync(connection, { link, deleted: true }).pipe(
										Effect.andThen(publishChatSyncLinks(link.hazelChannelId)),
									),
								{ discard: true },
							)

							const txid = yield* generateTransactionId()
							return { transactionId: txid }
						}),
					)
					.pipe(withRemapDbErrors("ChatSyncConnection", "delete")),

			"chatSync.channelLink.create": (payload) =>
				db
					.transaction(
						Effect.gen(function* () {
							const connectionOption = yield* connectionRepo.findById(payload.syncConnectionId)
							if (Option.isNone(connectionOption)) {
								return yield* Effect.fail(
									new ChatSyncConnectionNotFoundError({
										syncConnectionId: payload.syncConnectionId,
									}),
								)
							}
							const connection = connectionOption.value
							yield* integrationConnectionPolicy.canInsert(connection.organizationId)

							// Only a live channel of the connection's own org (this OrgObject's), not a thread:
							// a thread syncs through its channel's link.
							const channel = yield* db.first(
								SQLite.from(schema.channelsTable)
									.select("id", "type")
									.where(($) => [
										$.id.eq(payload.hazelChannelId),
										$.organizationId.eq(connection.organizationId),
										$.deletedAt.isNull(),
									])
									.limit(1),
							)
							if (Option.isNone(channel) || channel.value.type === "thread") {
								return yield* new ChannelNotFoundError({ channelId: payload.hazelChannelId })
							}

							const existingHazel = yield* channelLinkRepo.findByHazelChannel(
								payload.syncConnectionId,
								payload.hazelChannelId,
							)
							if (Option.isSome(existingHazel)) {
								return yield* Effect.fail(
									new ChatSyncChannelLinkExistsError({
										syncConnectionId: payload.syncConnectionId,
										hazelChannelId: payload.hazelChannelId,
										externalChannelId: payload.externalChannelId,
									}),
								)
							}

							const existingExternal = yield* channelLinkRepo.findByExternalChannel(
								payload.syncConnectionId,
								payload.externalChannelId,
							)
							// Another org syncs that channel already (first link wins): one install can
							// serve several orgs, and none may take another's channel.
							const owner = yield* indexedLinkOwner(
								connection.provider,
								connection.externalWorkspaceId,
								payload.externalChannelId,
							)
							if (
								Option.isSome(existingExternal) ||
								(Option.isSome(owner) && owner.value !== connection.organizationId)
							) {
								return yield* Effect.fail(
									new ChatSyncChannelLinkExistsError({
										syncConnectionId: payload.syncConnectionId,
										hazelChannelId: payload.hazelChannelId,
										externalChannelId: payload.externalChannelId,
									}),
								)
							}

							const link = yield* insertLink(connection, {
								hazelChannelId: payload.hazelChannelId,
								externalChannelId: payload.externalChannelId,
								externalChannelName: payload.externalChannelName ?? null,
								direction: payload.direction ?? "both",
								settings: payload.settings,
								history: {
									remaining: Math.min(
										payload.historyLimit ?? 0,
										isChatSyncProviderId(connection.provider)
											? chatSyncProviders[connection.provider].history.maxMessages
											: 0,
									),
									since: null,
								},
							})

							const brandedLink = {
								...link,
								externalChannelId: link.externalChannelId as ExternalChannelId,
							}
							const txid = yield* generateTransactionId()
							return new ChatSyncChannelLinkResponse({
								data: brandedLink,
								transactionId: txid,
							})
						}),
					)
					.pipe(withRemapDbErrors("ChatSyncChannelLink", "create")),

			"chatSync.migrate": (payload) =>
				db
					.transaction(
						Effect.gen(function* () {
							const connectionOption = yield* connectionRepo.findById(payload.syncConnectionId)
							if (
								Option.isNone(connectionOption) ||
								connectionOption.value.organizationId !== payload.organizationId
							) {
								return yield* new ChatSyncConnectionNotFoundError({
									syncConnectionId: payload.syncConnectionId,
								})
							}
							const connection = connectionOption.value
							yield* integrationConnectionPolicy.canInsert(connection.organizationId)
							const currentUser = yield* CurrentUser.Context
							yield* Effect.annotateCurrentSpan({
								"chat_sync.provider": connection.provider,
								"chat_sync.migration.channels": payload.channels.length,
								"chat_sync.migration.history": payload.history,
							})

							const budget =
								payload.history === "none" || !isChatSyncProviderId(connection.provider)
									? 0
									: CHAT_SYNC_MIGRATION_MAX_MESSAGES[connection.provider]
							const history = {
								remaining: budget,
								since: chatSyncHistorySince(payload.history, Date.now()),
							}
							const members = yield* organizationMemberRepo.findAllByOrganization(
								connection.organizationId,
							)
							const memberIds = new Set([currentUser.id, ...members.map((m) => m.userId)])

							// The org's live top-level public channels by name: a migrated channel
							// reuses one of its name (e.g. #general) instead of making a twin.
							const existingChannels = yield* db.run(
								SQLite.from(schema.channelsTable)
									.select("id", "name")
									.where(($) => [
										$.organizationId.eq(connection.organizationId),
										$.type.eq("public"),
										$.parentChannelId.isNull(),
										$.deletedAt.isNull(),
									]),
							)
							const channelByName = new Map(
								existingChannels.map((channel) => [channel.name.toLowerCase(), channel]),
							)
							const linkedHazelIds = new Set(
								(yield* channelLinkRepo.findBySyncConnection(connection.id)).map(
									(link) => link.hazelChannelId,
								),
							)

							const linked: Array<ChatSyncMigrateResponse["linked"][number]> = []
							const skipped: Array<ExternalChannelId> = []
							const seen = new Set<string>()
							for (const channel of payload.channels) {
								if (seen.has(channel.externalChannelId)) continue
								seen.add(channel.externalChannelId)
								const existingExternal = yield* channelLinkRepo.findByExternalChannel(
									connection.id,
									channel.externalChannelId,
								)
								const owner = yield* indexedLinkOwner(
									connection.provider,
									connection.externalWorkspaceId,
									channel.externalChannelId,
								)
								if (
									Option.isSome(existingExternal) ||
									(Option.isSome(owner) && owner.value !== connection.organizationId)
								) {
									skipped.push(channel.externalChannelId)
									continue
								}

								const name = migratedChannelName(channel.externalChannelName)
								const reusable = channelByName.get(name.toLowerCase())
								const hazelChannel =
									reusable !== undefined && !linkedHazelIds.has(reusable.id)
										? { id: reusable.id, name: reusable.name, created: false }
										: yield* Effect.gen(function* () {
												const [created] = yield* channelRepo.insert({
													name,
													icon: null,
													type: "public",
													organizationId: connection.organizationId,
													parentChannelId: null,
													sectionId: null,
													deletedAt: null,
												})
												yield* Effect.forEach(
													memberIds,
													(userId) => addMember(created!.id, userId),
													{ discard: true },
												)
												yield* syncChannelAccess(created!.id)
												yield* enqueueEffect(
													BotGatewayEffects.channelEvent,
													{ kind: "bot-gateway" },
													{ eventType: "channel.create", channel: created! },
												)
												return { id: created!.id, name, created: true }
											})
								linkedHazelIds.add(hazelChannel.id)

								yield* insertLink(connection, {
									hazelChannelId: hazelChannel.id,
									externalChannelId: channel.externalChannelId,
									externalChannelName: channel.externalChannelName,
									direction: "both",
									settings: undefined,
									history,
									startsImport: false,
								})
								linked.push({
									externalChannelId: channel.externalChannelId,
									hazelChannelId: hazelChannel.id,
									hazelChannelName: hazelChannel.name,
									createdChannel: hazelChannel.created,
								})
							}

							// One import chain for the whole migration: each channel starts when the
							// previous one is done, within the provider's rate limit.
							const [first, ...rest] = linked.map((link) => link.externalChannelId)
							if (budget > 0 && first !== undefined) {
								yield* enqueueEffect(
									ChatSyncHistoryEffects.importHistory,
									{ kind: "chat-sync" },
									{
										provider: connection.provider,
										externalWorkspaceId: connection.externalWorkspaceId,
										externalChannelId: first,
										remaining: budget,
										cursor: null,
										since: history.since,
										then: rest,
										budget,
									},
								)
							}

							yield* Effect.annotateCurrentSpan({
								"chat_sync.migration.linked": linked.length,
								"chat_sync.migration.skipped": skipped.length,
							})
							const txid = yield* generateTransactionId()
							return new ChatSyncMigrateResponse({ linked, skipped, transactionId: txid })
						}),
					)
					.pipe(withRemapDbErrors("ChatSyncChannelLink", "create")),

			"chatSync.channelLink.list": ({ syncConnectionId }) =>
				Effect.gen(function* () {
					const connectionOption = yield* connectionRepo.findById(syncConnectionId)
					if (Option.isNone(connectionOption)) {
						return yield* Effect.fail(
							new ChatSyncConnectionNotFoundError({
								syncConnectionId,
							}),
						)
					}
					const connection = connectionOption.value
					yield* integrationConnectionPolicy.canSelect(connection.organizationId)

					const links = yield* channelLinkRepo.findBySyncConnection(syncConnectionId)
					// A thread's link follows its channel's (direction, identity): only channels are listed.
					const threadLinks = yield* db.run(
						SQLite.from(schema.chatSyncChannelLinksTable, "link")
							.innerJoin(schema.channelsTable, "channel", (link, channel) =>
								channel.id.eq(link.hazelChannelId),
							)
							.select(($) => ({ id: $.id }))
							.where(($) => [
								$.syncConnectionId.eq(syncConnectionId),
								$.channel.type.eq("thread"),
							]),
					)
					const threadLinkIds = new Set(threadLinks.map((link) => link.id))
					const data = links.filter((link) => !threadLinkIds.has(link.id))
					return new ChatSyncChannelLinkListResponse({ data })
				}).pipe(withRemapDbErrors("ChatSyncChannelLink", "select")),

			"chatSync.channelLink.delete": ({ syncChannelLinkId }) =>
				db
					.transaction(
						Effect.gen(function* () {
							const linkOption = yield* channelLinkRepo.findById(syncChannelLinkId)
							if (Option.isNone(linkOption)) {
								return yield* Effect.fail(
									new ChatSyncChannelLinkNotFoundError({
										syncChannelLinkId,
									}),
								)
							}
							const link = linkOption.value

							const connectionOption = yield* connectionRepo.findById(link.syncConnectionId)
							if (Option.isNone(connectionOption)) {
								return yield* Effect.fail(
									new InternalServerError({
										message: "Sync connection not found for channel link",
										detail: `syncConnectionId=${link.syncConnectionId}`,
									}),
								)
							}
							yield* integrationConnectionPolicy.canDelete(
								connectionOption.value.organizationId,
							)

							// Its threads' links go with it: relinked later, the channel starts their threads anew.
							const threads = yield* threadLinksUnder(link)
							yield* Effect.forEach(
								threads,
								(thread) =>
									channelLinkRepo.softDelete(thread.id).pipe(
										Effect.andThen(
											indexChatSync(connectionOption.value, {
												link: thread,
												deleted: true,
											}),
										),
									),
								{ discard: true },
							)
							yield* channelLinkRepo.softDelete(syncChannelLinkId)
							yield* indexChatSync(connectionOption.value, { link, deleted: true })
							yield* publishChatSyncLinks(link.hazelChannelId)
							yield* Effect.forEach(
								threads,
								(thread) => publishChatSyncLinks(thread.hazelChannelId),
								{
									discard: true,
								},
							)
							const txid = yield* generateTransactionId()
							return { transactionId: txid }
						}),
					)
					.pipe(withRemapDbErrors("ChatSyncChannelLink", "delete")),
			"chatSync.channelLink.update": ({ syncChannelLinkId, direction, isActive }) =>
				db
					.transaction(
						Effect.gen(function* () {
							const linkOption = yield* channelLinkRepo.findById(syncChannelLinkId)
							if (Option.isNone(linkOption)) {
								return yield* Effect.fail(
									new ChatSyncChannelLinkNotFoundError({
										syncChannelLinkId,
									}),
								)
							}
							const link = linkOption.value

							const connectionOption = yield* connectionRepo.findById(link.syncConnectionId)
							if (Option.isNone(connectionOption)) {
								return yield* Effect.fail(
									new InternalServerError({
										message: "Sync connection not found for channel link",
										detail: `syncConnectionId=${link.syncConnectionId}`,
									}),
								)
							}
							yield* integrationConnectionPolicy.canUpdate(
								connectionOption.value.organizationId,
							)

							if (direction !== undefined) {
								yield* channelLinkRepo.updateDirection(syncChannelLinkId, direction)
							}
							if (isActive !== undefined) {
								yield* channelLinkRepo.setActive(syncChannelLinkId, isActive)
							}

							const updatedOption = yield* channelLinkRepo.findById(syncChannelLinkId)
							if (Option.isNone(updatedOption)) {
								return yield* Effect.fail(
									new ChatSyncChannelLinkNotFoundError({
										syncChannelLinkId,
									}),
								)
							}
							yield* publishChatSyncLinks(link.hazelChannelId)

							const txid = yield* generateTransactionId()
							return new ChatSyncChannelLinkResponse({
								data: updatedOption.value,
								transactionId: txid,
							})
						}),
					)
					.pipe(withRemapDbErrors("ChatSyncChannelLink", "update")),
		}
	}),
)
