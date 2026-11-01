/**
 * Chat sync configuration: connections and channel links. Runs in the org's `OrgObject`
 * (`rpc/routing.ts`), which owns both. Each change, inside its transaction, keeps the directory's
 * `chat_sync_index` current (the gateway routes by it) and re-projects the affected channels'
 * links to their `ChannelObject`s (`services/chat-sync/chat-sync-org.ts`).
 */
import {
	ChatSyncChannelLinkRepo,
	ChatSyncConnectionRepo,
	IntegrationConnectionRepo,
} from "@hazel/backend-core"
import { Database, SQLite, schema } from "@hazel/db"
import { ExternalChannelId } from "@hazel/schema"
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
	ChatSyncRpcs,
	ChannelNotFoundError,
} from "@hazel/domain/rpc"
import { Effect, Option } from "effect"
import { generateTransactionId } from "../../lib/create-transactionId"
import { IntegrationConnectionPolicy } from "../../policies/integration-connection-policy"
import { indexChatSync, publishChatSyncLinks } from "../../services/chat-sync/chat-sync-org"
import { ChatSyncDeliveryEffects } from "../../services/chat-sync/chat-sync-effects"
import { normalizeChannelLinkSettings } from "../../services/chat-sync/chat-sync-settings"
import { isChatSyncProviderId } from "../../services/chat-sync/provider"
import { chatSyncProviders } from "../../services/chat-sync/providers"
import { enqueueEffect } from "../../worker/objects/effects/registry"

export const ChatSyncRpcLive = ChatSyncRpcs.toLayer(
	Effect.gen(function* () {
		const db = yield* Database.Database
		const connectionRepo = yield* ChatSyncConnectionRepo
		const channelLinkRepo = yield* ChatSyncChannelLinkRepo
		const integrationConnectionRepo = yield* IntegrationConnectionRepo
		const integrationConnectionPolicy = yield* IntegrationConnectionPolicy

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

							// Only a live channel of the connection's own org (this OrgObject's).
							const channel = yield* db.first(
								SQLite.from(schema.channelsTable)
									.select("id")
									.where(($) => [
										$.id.eq(payload.hazelChannelId),
										$.organizationId.eq(connection.organizationId),
										$.deletedAt.isNull(),
									])
									.limit(1),
							)
							if (Option.isNone(channel)) {
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
							if (Option.isSome(existingExternal)) {
								return yield* Effect.fail(
									new ChatSyncChannelLinkExistsError({
										syncConnectionId: payload.syncConnectionId,
										hazelChannelId: payload.hazelChannelId,
										externalChannelId: payload.externalChannelId,
									}),
								)
							}

							const [link] = yield* channelLinkRepo.insert({
								syncConnectionId: payload.syncConnectionId,
								hazelChannelId: payload.hazelChannelId,
								externalChannelId: payload.externalChannelId,
								externalChannelName: payload.externalChannelName ?? null,
								direction: payload.direction ?? "both",
								isActive: true,
								settings: normalizeChannelLinkSettings(payload.settings),
								lastSyncedAt: null,
								deletedAt: null,
							})
							yield* indexChatSync(connection, { link: link!, deleted: false })
							yield* publishChatSyncLinks(link!.hazelChannelId)
							yield* enqueueEffect(
								ChatSyncDeliveryEffects.prepareLink,
								{ kind: "chat-sync" },
								{
									provider: connection.provider,
									externalWorkspaceId: connection.externalWorkspaceId,
									externalChannelId: link!.externalChannelId as ExternalChannelId,
								},
							)

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

					const data = yield* channelLinkRepo.findBySyncConnection(syncConnectionId)
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

							yield* channelLinkRepo.softDelete(syncChannelLinkId)
							yield* indexChatSync(connectionOption.value, { link, deleted: true })
							yield* publishChatSyncLinks(link.hazelChannelId)
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
