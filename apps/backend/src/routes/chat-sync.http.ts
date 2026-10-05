import {
	ChatSyncChannelLinkExistsError,
	ChatSyncChannelLinkNotFoundError,
	ChatSyncChannelLinkResponse,
	ChatSyncChannelLinkListResponse,
	ChatSyncConnectionExistsError,
	ChatSyncIntegrationNotConnectedError,
	ChatSyncConnectionNotFoundError,
	ChatSyncConnectionResponse,
	ChatSyncConnectionListResponse,
	ChatSyncDeleteResponse,
} from "@hazel/domain/http"
import {
	ChatSyncChannelLinkRepo,
	ChatSyncConnectionRepo,
	IntegrationConnectionRepo,
} from "@hazel/backend-core"
import { ExternalChannelId } from "@hazel/schema"
import { CurrentUser, InternalServerError, UnauthorizedError } from "@hazel/domain"
import { HttpApiBuilder } from "effect/http-api"
import { Effect, Option } from "effect"
import { HazelApi } from "../api"
import { generateTransactionId } from "../lib/create-transactionId"

const ensureOrgAccess = Effect.fn("chatSync.ensureOrgAccess")(function* (organizationId: string) {
	const currentUser = yield* CurrentUser.Context
	if (!currentUser.organizationId || currentUser.organizationId !== organizationId) {
		return yield* Effect.fail(
			new UnauthorizedError({
				message: "You are not authorized to access this organization",
				detail: `organizationId=${organizationId}`,
			}),
		)
	}
})

const toInternalServerError = (message: string, error: unknown) =>
	new InternalServerError({
		message,
		detail: String(error),
	})

const normalizeChannelLinkSettings = (
	settings: Record<string, unknown> | null | undefined,
): Record<string, unknown> => ({
	...(settings ?? {}),
	outboundIdentity: settings?.outboundIdentity ?? {
		enabled: false,
		strategy: "webhook",
		providers: {},
	},
})

export const HttpChatSyncLive = HttpApiBuilder.group(HazelApi, "chat-sync", (handlers) =>
	Effect.gen(function* () {
		const connectionRepo = yield* ChatSyncConnectionRepo
		const channelLinkRepo = yield* ChatSyncChannelLinkRepo
		const integrationConnectionRepo = yield* IntegrationConnectionRepo

		return handlers
			.handle("createConnection", ({ params, payload }) =>
				Effect.gen(function* () {
					yield* ensureOrgAccess(params.orgId)
					const currentUser = yield* CurrentUser.Context

					const integrationConnectionId = yield* Effect.gen(function* () {
						if (payload.provider !== "discord") {
							return payload.integrationConnectionId ?? null
						}

						if (payload.integrationConnectionId) {
							return payload.integrationConnectionId
						}

						const integrationOption = yield* integrationConnectionRepo.findOrgConnection(
							params.orgId,
							"discord",
						)
						if (Option.isNone(integrationOption) || integrationOption.value.status !== "active") {
							return yield* Effect.fail(
								new ChatSyncIntegrationNotConnectedError({
									organizationId: params.orgId,
									provider: "discord",
								}),
							)
						}

						return integrationOption.value.id
					})

					const existing = yield* connectionRepo.findByProviderAndWorkspace(
						params.orgId,
						payload.provider,
						payload.externalWorkspaceId,
					)
					if (Option.isSome(existing)) {
						return yield* Effect.fail(
							new ChatSyncConnectionExistsError({
								organizationId: params.orgId,
								provider: payload.provider,
								externalWorkspaceId: payload.externalWorkspaceId,
							}),
						)
					}

					const [connection] = yield* connectionRepo.insert({
						organizationId: params.orgId,
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

					const txid = yield* generateTransactionId()
					return new ChatSyncConnectionResponse({ data: connection, transactionId: txid })
				}).pipe(
					Effect.catchTag("SchemaError", (error) =>
						Effect.fail(toInternalServerError("Invalid sync connection data", error)),
					),
					Effect.catchTag("DatabaseError", (error) =>
						Effect.fail(
							toInternalServerError("Database error while creating sync connection", error),
						),
					),
				),
			)
			.handle("listConnections", ({ params }) =>
				Effect.gen(function* () {
					yield* ensureOrgAccess(params.orgId)
					const connections = yield* connectionRepo.findByOrganization(params.orgId)
					return new ChatSyncConnectionListResponse({ data: connections })
				}).pipe(
					Effect.catchTag("DatabaseError", (error) =>
						Effect.fail(
							toInternalServerError("Database error while listing sync connections", error),
						),
					),
				),
			)
			.handle("deleteConnection", ({ params }) =>
				Effect.gen(function* () {
					const connectionOption = yield* connectionRepo.findById(params.syncConnectionId)
					if (Option.isNone(connectionOption)) {
						return yield* Effect.fail(
							new ChatSyncConnectionNotFoundError({
								syncConnectionId: params.syncConnectionId,
							}),
						)
					}
					const connection = connectionOption.value
					yield* ensureOrgAccess(connection.organizationId)

					yield* connectionRepo.softDelete(params.syncConnectionId)

					const links = yield* channelLinkRepo.findBySyncConnection(params.syncConnectionId)
					yield* Effect.forEach(links, (link) => channelLinkRepo.softDelete(link.id), {
						concurrency: 10,
					})

					const txid = yield* generateTransactionId()
					return new ChatSyncDeleteResponse({ transactionId: txid })
				}).pipe(
					Effect.catchTag("DatabaseError", (error) =>
						Effect.fail(
							toInternalServerError("Database error while deleting sync connection", error),
						),
					),
				),
			)
			.handle("createChannelLink", ({ params, payload }) =>
				Effect.gen(function* () {
					const connectionOption = yield* connectionRepo.findById(params.syncConnectionId)
					if (Option.isNone(connectionOption)) {
						return yield* Effect.fail(
							new ChatSyncConnectionNotFoundError({
								syncConnectionId: params.syncConnectionId,
							}),
						)
					}
					const connection = connectionOption.value
					yield* ensureOrgAccess(connection.organizationId)

					const existingHazel = yield* channelLinkRepo.findByHazelChannel(
						params.syncConnectionId,
						payload.hazelChannelId,
					)
					if (Option.isSome(existingHazel)) {
						return yield* Effect.fail(
							new ChatSyncChannelLinkExistsError({
								syncConnectionId: params.syncConnectionId,
								hazelChannelId: payload.hazelChannelId,
								externalChannelId: payload.externalChannelId,
							}),
						)
					}

					const existingExternal = yield* channelLinkRepo.findByExternalChannel(
						params.syncConnectionId,
						payload.externalChannelId,
					)
					if (Option.isSome(existingExternal)) {
						return yield* Effect.fail(
							new ChatSyncChannelLinkExistsError({
								syncConnectionId: params.syncConnectionId,
								hazelChannelId: payload.hazelChannelId,
								externalChannelId: payload.externalChannelId,
							}),
						)
					}

					const [link] = yield* channelLinkRepo.insert({
						syncConnectionId: params.syncConnectionId,
						hazelChannelId: payload.hazelChannelId,
						externalChannelId: payload.externalChannelId,
						externalChannelName: payload.externalChannelName ?? null,
						direction: payload.direction ?? "both",
						isActive: true,
						settings: normalizeChannelLinkSettings(payload.settings),
						lastSyncedAt: null,
						deletedAt: null,
					})

					const brandedLink = {
						...link,
						externalChannelId: link.externalChannelId as ExternalChannelId,
					}
					const txid = yield* generateTransactionId()
					return new ChatSyncChannelLinkResponse({ data: brandedLink, transactionId: txid })
				}).pipe(
					Effect.catchTag("SchemaError", (error) =>
						Effect.fail(toInternalServerError("Invalid channel link data", error)),
					),
					Effect.catchTag("DatabaseError", (error) =>
						Effect.fail(
							toInternalServerError("Database error while creating channel link", error),
						),
					),
				),
			)
			.handle("listChannelLinks", ({ params }) =>
				Effect.gen(function* () {
					const connectionOption = yield* connectionRepo.findById(params.syncConnectionId)
					if (Option.isNone(connectionOption)) {
						return yield* Effect.fail(
							new ChatSyncConnectionNotFoundError({
								syncConnectionId: params.syncConnectionId,
							}),
						)
					}
					const connection = connectionOption.value
					yield* ensureOrgAccess(connection.organizationId)

					const links = yield* channelLinkRepo.findBySyncConnection(params.syncConnectionId)
					return new ChatSyncChannelLinkListResponse({ data: links })
				}).pipe(
					Effect.catchTag("DatabaseError", (error) =>
						Effect.fail(
							toInternalServerError("Database error while listing channel links", error),
						),
					),
				),
			)
			.handle("deleteChannelLink", ({ params }) =>
				Effect.gen(function* () {
					const linkOption = yield* channelLinkRepo.findById(params.syncChannelLinkId)
					if (Option.isNone(linkOption)) {
						return yield* Effect.fail(
							new ChatSyncChannelLinkNotFoundError({
								syncChannelLinkId: params.syncChannelLinkId,
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
					yield* ensureOrgAccess(connectionOption.value.organizationId)

					yield* channelLinkRepo.softDelete(params.syncChannelLinkId)
					const txid = yield* generateTransactionId()
					return new ChatSyncDeleteResponse({ transactionId: txid })
				}).pipe(
					Effect.catchTag("DatabaseError", (error) =>
						Effect.fail(
							toInternalServerError("Database error while deleting channel link", error),
						),
					),
				),
			)
	}),
)
