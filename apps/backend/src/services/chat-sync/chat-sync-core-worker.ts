import { createHash } from "node:crypto"
import { and, asc, Database, eq, isNull, schema } from "@hazel/db"
import {
	ChannelRepo,
	ChatSyncChannelLinkRepo,
	ChatSyncConnectionRepo,
	ChatSyncEventReceiptRepo,
	ChatSyncMessageLinkRepo,
	IntegrationConnectionRepo,
	MessageOutboxRepo,
	MessageReactionRepo,
	MessageRepo,
	OrganizationMemberRepo,
	UserRepo,
} from "@hazel/backend-core"
import { ChatSyncChannelLink, ChatSyncConnection, IntegrationConnection } from "@hazel/domain/models"
import {
	MessageId,
	MessageReactionId,
	ChannelId,
	OrganizationId,
	SyncChannelLinkId,
	SyncConnectionId,
	UserId,
	ExternalChannelId,
	ExternalMessageId,
	ExternalUserId,
	ExternalWebhookId,
	ExternalThreadId,
} from "@hazel/schema"
import { Context, Config, Effect, Layer, Option, Redacted, Schema } from "effect"
import { transactionAwareExecute } from "../../lib/transaction-aware-execute"
import { ChannelAccessSyncService } from "../channel-access-sync"
import { IntegrationBotService } from "../integrations/integration-bot-service"
import { ChatSyncProviderRegistry } from "./chat-sync-provider-registry"
import { Discord } from "@hazel/integrations"
import {
	type ChatSyncAttachmentLink,
	type ChatSyncOutboundAttachment,
	formatMessageContentWithAttachments,
} from "./chat-sync-attachment-content"

export const DEFAULT_MAX_MESSAGES_PER_CHANNEL = 50
export const DEFAULT_CHAT_SYNC_CONCURRENCY = 5

export class DiscordSyncConfigurationError extends Schema.TaggedError<DiscordSyncConfigurationError>()(
	"DiscordSyncConfigurationError",
	{
		message: Schema.String,
	},
) {}

export class DiscordSyncConnectionNotFoundError extends Schema.TaggedError<DiscordSyncConnectionNotFoundError>()(
	"DiscordSyncConnectionNotFoundError",
	{
		syncConnectionId: SyncConnectionId,
	},
) {}

export class DiscordSyncChannelLinkNotFoundError extends Schema.TaggedError<DiscordSyncChannelLinkNotFoundError>()(
	"DiscordSyncChannelLinkNotFoundError",
	{
		syncConnectionId: SyncConnectionId,
		externalChannelId: Schema.optional(ExternalChannelId),
	},
) {}

export class DiscordSyncMessageNotFoundError extends Schema.TaggedError<DiscordSyncMessageNotFoundError>()(
	"DiscordSyncMessageNotFoundError",
	{
		messageId: MessageId,
	},
) {}

export class DiscordSyncApiError extends Schema.TaggedError<DiscordSyncApiError>()("DiscordSyncApiError", {
	message: Schema.String,
	status: Schema.optional(Schema.Number),
	detail: Schema.optional(Schema.String),
}) {}

type ChatSyncProvider = ChatSyncConnection.ChatSyncProvider

export interface ChatSyncIngressMessageAttachment extends ChatSyncAttachmentLink {
	readonly externalAttachmentId?: string
}

export interface ChatSyncIngressMessageCreate {
	readonly syncConnectionId: SyncConnectionId
	readonly externalChannelId: ExternalChannelId
	readonly externalMessageId: ExternalMessageId
	readonly externalWebhookId?: ExternalWebhookId
	readonly content: string
	readonly externalAuthorId?: ExternalUserId
	readonly externalAuthorDisplayName?: string
	readonly externalAuthorAvatarUrl?: string | null
	readonly externalReplyToMessageId?: ExternalMessageId | null
	readonly externalThreadId?: ExternalThreadId | null
	readonly externalAttachments?: ReadonlyArray<ChatSyncIngressMessageAttachment>
	readonly dedupeKey?: string
}

export interface ChatSyncIngressMessageUpdate {
	readonly syncConnectionId: SyncConnectionId
	readonly externalChannelId: ExternalChannelId
	readonly externalMessageId: ExternalMessageId
	readonly externalWebhookId?: ExternalWebhookId
	readonly content: string
	readonly dedupeKey?: string
}

export interface ChatSyncIngressMessageDelete {
	readonly syncConnectionId: SyncConnectionId
	readonly externalChannelId: ExternalChannelId
	readonly externalMessageId: ExternalMessageId
	readonly externalWebhookId?: ExternalWebhookId
	readonly dedupeKey?: string
}

export interface ChatSyncIngressReactionAdd {
	readonly syncConnectionId: SyncConnectionId
	readonly externalChannelId: ExternalChannelId
	readonly externalMessageId: ExternalMessageId
	readonly externalUserId: ExternalUserId
	readonly emoji: string
	readonly externalAuthorDisplayName?: string
	readonly externalAuthorAvatarUrl?: string | null
	readonly dedupeKey?: string
}

export interface ChatSyncIngressReactionRemove {
	readonly syncConnectionId: SyncConnectionId
	readonly externalChannelId: ExternalChannelId
	readonly externalMessageId: ExternalMessageId
	readonly externalUserId: ExternalUserId
	readonly emoji: string
	readonly externalAuthorDisplayName?: string
	readonly externalAuthorAvatarUrl?: string | null
	readonly dedupeKey?: string
}

export interface ChatSyncIngressThreadCreate {
	readonly syncConnectionId: SyncConnectionId
	readonly externalParentChannelId: ExternalChannelId
	readonly externalThreadId: ExternalThreadId
	readonly externalRootMessageId?: ExternalMessageId | null
	readonly name?: string | null
	readonly dedupeKey?: string
}

// Tag-only service: real implementation is provided via ChatSyncCoreWorkerMake + ChatSyncCoreWorkerLayer.
// Uses two-type-param overload to avoid requiring `make` (which would cause circular inference with DiscordSyncWorker).
// Shape uses `Record<string, Function>` because the real shape can't be inferred without circular deps.
// Consumers can access methods via `yield* ChatSyncCoreWorker` — method calls are checked at each call site.
export class ChatSyncCoreWorker extends Context.Service<
	ChatSyncCoreWorker,
	// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
	Record<string, Function>
>()("ChatSyncCoreWorker") {}

/** @internal — exported for integration tests that provide their own deps */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export const ChatSyncCoreWorkerMake: Effect.Effect<Record<string, Function>, unknown, unknown> = Effect.gen(
	function* () {
		const db = yield* Database.Database
		const connectionRepo = yield* ChatSyncConnectionRepo
		const channelLinkRepo = yield* ChatSyncChannelLinkRepo
		const messageLinkRepo = yield* ChatSyncMessageLinkRepo
		const eventReceiptRepo = yield* ChatSyncEventReceiptRepo
		const messageRepo = yield* MessageRepo
		const outboxRepo = yield* MessageOutboxRepo
		const messageReactionRepo = yield* MessageReactionRepo
		const channelRepo = yield* ChannelRepo
		const integrationConnectionRepo = yield* IntegrationConnectionRepo
		const userRepo = yield* UserRepo
		const organizationMemberRepo = yield* OrganizationMemberRepo
		const integrationBotService = yield* IntegrationBotService
		const channelAccessSyncService = yield* ChannelAccessSyncService
		const providerRegistry = yield* ChatSyncProviderRegistry
		const discordApiClient = yield* Discord.DiscordApiClient

		const payloadHash = (value: unknown): string =>
			createHash("sha256").update(JSON.stringify(value)).digest("hex")

		const claimReceipt = Effect.fn("discordSyncWorker.claimReceipt")(function* (params: {
			syncConnectionId: SyncConnectionId
			channelLinkId?: SyncChannelLinkId
			source: "hazel" | "external"
			dedupeKey: string
		}) {
			return yield* eventReceiptRepo.claimByDedupeKey({
				syncConnectionId: params.syncConnectionId,
				channelLinkId: params.channelLinkId,
				source: params.source,
				dedupeKey: params.dedupeKey,
			})
		})

		const writeReceipt = Effect.fn("discordSyncWorker.writeReceipt")(function* (params: {
			syncConnectionId: SyncConnectionId
			channelLinkId?: SyncChannelLinkId
			source: "hazel" | "external"
			dedupeKey: string
			status?: "processed" | "ignored" | "failed"
			errorMessage?: string
			payload?: unknown
		}) {
			yield* eventReceiptRepo.updateByDedupeKey({
				syncConnectionId: params.syncConnectionId,
				source: params.source,
				dedupeKey: params.dedupeKey,
				channelLinkId: params.channelLinkId,
				externalEventId: null,
				payloadHash: params.payload ? payloadHash(params.payload) : null,
				status: params.status ?? "processed",
				errorMessage: params.errorMessage ?? null,
			})
		})

		const getProviderAdapter = Effect.fn("ChatSyncCoreWorker.getProviderAdapter")(function* (
			provider: ChatSyncProvider,
		) {
			return yield* providerRegistry.getAdapter(provider)
		})

		const buildAttachmentPublicUrl = (baseUrl: string, attachmentId: string): string => {
			const normalizedBase = baseUrl.replace(/\/+$/, "")
			return `${normalizedBase}/${attachmentId}`
		}

		const getAttachmentPublicUrlBase = Effect.fn("discordSyncWorker.getAttachmentPublicUrlBase")(
			function* () {
				const configuredBaseUrl = yield* Config.String("S3_PUBLIC_URL").pipe(Config.option)
				if (Option.isNone(configuredBaseUrl) || configuredBaseUrl.value.trim().length === 0) {
					return yield* Effect.fail(
						new DiscordSyncConfigurationError({
							message: "S3_PUBLIC_URL is required for syncing message attachments",
						}),
					)
				}
				return configuredBaseUrl.value.trim()
			},
		)

		const listMessageAttachmentsForOutboundSync = Effect.fn(
			"discordSyncWorker.listMessageAttachmentsForOutboundSync",
		)(function* (hazelMessageId: MessageId) {
			const rows = yield* db.execute((client) =>
				client
					.select({
						id: schema.attachmentsTable.id,
						fileName: schema.attachmentsTable.fileName,
						fileSize: schema.attachmentsTable.fileSize,
					})
					.from(schema.attachmentsTable)
					.where(
						and(
							eq(schema.attachmentsTable.messageId, hazelMessageId),
							eq(schema.attachmentsTable.status, "complete"),
							isNull(schema.attachmentsTable.deletedAt),
						),
					)
					.orderBy(asc(schema.attachmentsTable.uploadedAt), asc(schema.attachmentsTable.id)),
			)

			if (rows.length === 0) {
				return []
			}

			const publicUrlBase = yield* getAttachmentPublicUrlBase()
			return rows.map((row) => ({
				id: row.id,
				fileName: row.fileName,
				fileSize: row.fileSize,
				publicUrl: buildAttachmentPublicUrl(publicUrlBase, row.id),
			}))
		})

		const getOrCreateShadowUserId = Effect.fn("discordSyncWorker.getOrCreateShadowUserId")(
			function* (params: {
				provider: ChatSyncProvider
				organizationId: OrganizationId
				externalUserId: ExternalUserId
				displayName: string
				avatarUrl: string | null
				syncAvatarUrl?: boolean
			}) {
				const externalId = `${params.provider}-user-${params.externalUserId}`
				const user = yield* userRepo.upsertByExternalId(
					{
						externalId,
						email: `${externalId}@${params.provider}.internal`,
						firstName: params.displayName,
						lastName: "",
						avatarUrl: params.avatarUrl ?? "",
						userType: "machine",
						settings: null,
						isOnboarded: true,
						timezone: null,
						deletedAt: null,
					},
					{ syncAvatarUrl: params.syncAvatarUrl ?? false },
				)

				yield* organizationMemberRepo.upsertByOrgAndUser({
					organizationId: params.organizationId,
					userId: user.id,
					role: "member",
					nickname: null,
					joinedAt: new Date(),
					invitedBy: null,
					deletedAt: null,
				})

				return user.id
			},
		)

		const decodeProvider = Schema.decodeUnknownSync(IntegrationConnection.IntegrationProvider)

		type WebhookPermissionStatus = "unknown" | "allowed" | "denied"

		type WebhookPermissionState = {
			status: WebhookPermissionStatus
			checkedAt: string
			reason?: string
		}

		const getRawWebhookPermissionState = (
			settings: Record<string, unknown> | null | undefined,
		): WebhookPermissionState | undefined => {
			const raw = settings?.webhookPermission
			if (!raw || typeof raw !== "object") {
				return undefined
			}

			const status = (raw as { status?: unknown }).status
			if (status !== "allowed" && status !== "denied" && status !== "unknown") {
				return undefined
			}

			const checkedAt = (raw as { checkedAt?: unknown }).checkedAt
			const reason = (raw as { reason?: unknown }).reason

			return {
				status,
				checkedAt:
					typeof checkedAt === "string" && checkedAt.trim().length > 0
						? checkedAt
						: new Date().toISOString(),
				reason: typeof reason === "string" && reason.trim().length > 0 ? reason : undefined,
			}
		}

		const makeWebhookPermissionState = (params: {
			status: WebhookPermissionStatus
			reason?: string
		}): WebhookPermissionState => ({
			status: params.status,
			checkedAt: new Date().toISOString(),
			...(params.reason ? { reason: params.reason } : {}),
		})

		const isDiscordApiError = (error: unknown): error is Discord.DiscordApiError =>
			typeof error === "object" &&
			error !== null &&
			(error as { _tag?: unknown })._tag === "DiscordApiError"

		const isWebhookStrategyEnabled = (
			outboundIdentity: ChatSyncChannelLink.OutboundIdentitySettings,
		): boolean => outboundIdentity.enabled && outboundIdentity.strategy === "webhook"

		const defaultOutboundIdentitySettings = (): ChatSyncChannelLink.OutboundIdentitySettings => ({
			enabled: false,
			strategy: "webhook",
			providers: {},
		})

		const getRawOutboundIdentitySettings = (
			settings: Record<string, unknown> | null | undefined,
		): Record<string, unknown> | undefined => {
			const raw = settings?.outboundIdentity
			if (!raw || typeof raw !== "object") {
				return undefined
			}
			return raw as Record<string, unknown>
		}

		const getOutboundIdentitySettings = (
			settings: Record<string, unknown> | null | undefined,
		): ChatSyncChannelLink.OutboundIdentitySettings => {
			const raw = getRawOutboundIdentitySettings(settings)
			if (raw === undefined) {
				return defaultOutboundIdentitySettings()
			}
			try {
				return Schema.decodeUnknownSync(ChatSyncChannelLink.OutboundIdentitySettings)(raw)
			} catch {
				return defaultOutboundIdentitySettings()
			}
		}

		const getDiscordWebhookConfig = (
			outboundIdentity: ChatSyncChannelLink.OutboundIdentitySettings,
		): Option.Option<ChatSyncChannelLink.DiscordWebhookOutboundIdentityConfig> => {
			const providerConfig = (outboundIdentity.providers as Record<string, unknown>)["discord"]
			if (
				typeof providerConfig !== "object" ||
				providerConfig === null ||
				!(providerConfig as { kind?: unknown }).kind
			) {
				return Option.none()
			}

			if ((providerConfig as { kind?: string }).kind !== "discord.webhook") {
				return Option.none()
			}

			try {
				return Option.some(
					Schema.decodeUnknownSync(ChatSyncChannelLink.DiscordWebhookOutboundIdentityConfig)(
						providerConfig,
					),
				)
			} catch {
				return Option.none()
			}
		}

		const shouldIgnoreWebhookOrigin = (
			provider: ChatSyncProvider,
			settings: Record<string, unknown> | null | undefined,
			externalWebhookId: ExternalWebhookId | undefined,
		): boolean => {
			if (!externalWebhookId || provider !== "discord") {
				return false
			}
			const outboundIdentity = getOutboundIdentitySettings(settings)
			if (!isWebhookStrategyEnabled(outboundIdentity)) {
				return false
			}
			const webhookConfig = getDiscordWebhookConfig(outboundIdentity)
			return Option.isSome(webhookConfig) && webhookConfig.value.webhookId === externalWebhookId
		}

		const persistWebhookIdentity = Effect.fn("discordSyncWorker.persistWebhookIdentity")(function* (
			link: {
				id: SyncChannelLinkId
				settings: Record<string, unknown> | null
			},
			outboundIdentity: ChatSyncChannelLink.OutboundIdentitySettings,
			webhookPermissionState?: WebhookPermissionState,
		) {
			const currentRawOutboundIdentity =
				getRawOutboundIdentitySettings(link.settings) ?? defaultOutboundIdentitySettings()
			const currentProviders =
				typeof currentRawOutboundIdentity.providers === "object" &&
				currentRawOutboundIdentity.providers !== null
					? (currentRawOutboundIdentity.providers as Record<string, unknown>)
					: {}

			const nextSettings = {
				...(link.settings ?? {}),
				outboundIdentity: {
					...currentRawOutboundIdentity,
					enabled: outboundIdentity.enabled,
					strategy: outboundIdentity.strategy,
					providers: {
						...currentProviders,
						...outboundIdentity.providers,
					},
				},
				...(webhookPermissionState ? { webhookPermission: webhookPermissionState } : {}),
			}
			yield* channelLinkRepo.updateSettings(link.id, nextSettings)
		})

		const ensureDiscordWebhookIdentity = Effect.fn("discordSyncWorker.ensureDiscordWebhookIdentity")(
			function* (params: {
				provider: ChatSyncProvider
				link: {
					id: SyncChannelLinkId
					externalChannelId: ExternalChannelId
					settings: Record<string, unknown> | null
				}
			}) {
				const outboundIdentity = getOutboundIdentitySettings(params.link.settings)
				if (params.provider !== "discord") {
					return Option.none()
				}

				if (!isWebhookStrategyEnabled(outboundIdentity)) {
					return Option.none()
				}

				const webhookPermissionState =
					getRawWebhookPermissionState(params.link.settings) ??
					makeWebhookPermissionState({ status: "unknown" })
				if (webhookPermissionState.status === "denied") {
					return Option.none()
				}

				return yield* Effect.gen(function* () {
					const currentConfig = getDiscordWebhookConfig(outboundIdentity)
					if (Option.isSome(currentConfig)) {
						if (!outboundIdentity.enabled) {
							return Option.none()
						}
						return currentConfig
					}

					const botTokenOption = yield* Config.Redacted("DISCORD_BOT_TOKEN").pipe(Config.option)
					if (Option.isNone(botTokenOption)) {
						return Option.none()
					}
					const botToken = Redacted.value(botTokenOption.value)

					const created = yield* discordApiClient.createWebhook({
						channelId: params.link.externalChannelId,
						botToken,
					})

					const nextConfig: ChatSyncChannelLink.DiscordWebhookOutboundIdentityConfig = {
						kind: "discord.webhook",
						webhookId: created.webhookId,
						webhookToken: created.webhookToken,
					}

					const nextOutboundIdentity: ChatSyncChannelLink.OutboundIdentitySettings = {
						enabled: true,
						strategy: "webhook",
						providers: {
							...outboundIdentity.providers,
							discord: nextConfig,
						},
					}

					yield* persistWebhookIdentity(
						params.link,
						nextOutboundIdentity,
						makeWebhookPermissionState({ status: "allowed" }),
					)
					return Option.some(nextConfig)
				}).pipe(
					Effect.catch((error) =>
						Effect.gen(function* () {
							if (isDiscordApiError(error) && error.status === 403) {
								const fallbackOutboundIdentity: ChatSyncChannelLink.OutboundIdentitySettings =
									{
										enabled: outboundIdentity.enabled,
										strategy: "fallback_bot",
										providers: outboundIdentity.providers,
									}

								yield* persistWebhookIdentity(
									params.link,
									fallbackOutboundIdentity,
									makeWebhookPermissionState({
										status: "denied",
										reason: `Webhook create forbidden (HTTP ${error.status})`,
									}),
								)
							} else {
								const reason =
									typeof error === "object" && error !== null && "message" in error
										? String((error as { message?: unknown }).message)
										: undefined

								yield* persistWebhookIdentity(
									params.link,
									outboundIdentity,
									makeWebhookPermissionState({ status: "unknown", reason }),
								)
							}

							yield* Effect.logWarning("Failed to provision Discord webhook identity", {
								provider: params.provider,
								externalChannelId: params.link.externalChannelId,
								error: String(error),
							})
							return Option.none()
						}),
					),
				)
			},
		)

		const getDiscordWebhookIdentityMessageMetadata = Effect.fn(
			"discordSyncWorker.getDiscordWebhookIdentityMessageMetadata",
		)(function* (authorId: UserId) {
			const userOption = yield* userRepo.findById(authorId)
			if (Option.isNone(userOption)) {
				return {
					username: "Discord User",
					avatarUrl: undefined as string | undefined,
				}
			}

			const user = userOption.value
			const username =
				[user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.firstName
			const avatarUrl = user.avatarUrl && user.avatarUrl.trim() ? user.avatarUrl : undefined
			return { username, avatarUrl }
		})

		const sendDiscordMessageViaWebhook = Effect.fn("discordSyncWorker.sendDiscordMessageViaWebhook")(
			function* (params: {
				link: {
					id: SyncChannelLinkId
					externalChannelId: ExternalChannelId
					settings: Record<string, unknown> | null
				}
				message: { authorId: UserId }
				content: string
				attachments?: ReadonlyArray<ChatSyncOutboundAttachment>
				replyToExternalMessageId?: ExternalMessageId
			}) {
				return yield* Effect.gen(function* () {
					const outboundIdentity = getOutboundIdentitySettings(params.link.settings)
					if (!isWebhookStrategyEnabled(outboundIdentity)) {
						return Option.none()
					}

					const config = yield* ensureDiscordWebhookIdentity({
						provider: "discord",
						link: params.link,
					})
					if (Option.isNone(config)) {
						return Option.none()
					}

					const metadata = yield* getDiscordWebhookIdentityMessageMetadata(params.message.authorId)
					const outboundContent =
						params.attachments && params.attachments.length > 0
							? formatMessageContentWithAttachments({
									content: params.content,
									attachments: params.attachments,
								})
							: params.content
					const outboundMessageId = yield* discordApiClient.executeWebhookMessage({
						webhookId: config.value.webhookId,
						webhookToken: config.value.webhookToken,
						content: outboundContent,
						replyToExternalMessageId: params.replyToExternalMessageId,
						username: metadata.username,
						avatarUrl: metadata.avatarUrl ?? config.value.defaultAvatarUrl,
					})

					return Option.some(outboundMessageId as ExternalMessageId)
				}).pipe(
					Effect.catch((error) =>
						Effect.gen(function* () {
							yield* Effect.logWarning("Discord webhook send failed; falling back to bot API", {
								error: String(error),
							})
							return Option.none()
						}),
					),
				)
			},
		)

		const updateDiscordMessageViaWebhook = Effect.fn("discordSyncWorker.updateDiscordMessageViaWebhook")(
			function* (params: {
				link: {
					id: SyncChannelLinkId
					externalChannelId: ExternalChannelId
					settings: Record<string, unknown> | null
				}
				externalMessageId: ExternalMessageId
				content: string
			}) {
				return yield* Effect.gen(function* () {
					const outboundIdentity = getOutboundIdentitySettings(params.link.settings)
					if (!isWebhookStrategyEnabled(outboundIdentity)) {
						return false
					}

					const config = yield* ensureDiscordWebhookIdentity({
						provider: "discord",
						link: params.link,
					})
					if (Option.isNone(config)) {
						return false
					}

					yield* discordApiClient.updateWebhookMessage({
						webhookId: config.value.webhookId,
						webhookToken: config.value.webhookToken,
						webhookMessageId: params.externalMessageId,
						content: params.content,
					})

					return true
				}).pipe(
					Effect.catch((error) =>
						Effect.gen(function* () {
							yield* Effect.logWarning(
								"Discord webhook update failed; falling back to bot API",
								{
									error: String(error),
								},
							)
							return false
						}),
					),
				)
			},
		)

		const deleteDiscordMessageViaWebhook = Effect.fn("discordSyncWorker.deleteDiscordMessageViaWebhook")(
			function* (params: {
				link: {
					id: SyncChannelLinkId
					externalChannelId: ExternalChannelId
					settings: Record<string, unknown> | null
				}
				externalMessageId: ExternalMessageId
			}) {
				return yield* Effect.gen(function* () {
					const outboundIdentity = getOutboundIdentitySettings(params.link.settings)
					if (!isWebhookStrategyEnabled(outboundIdentity)) {
						return false
					}

					const config = yield* ensureDiscordWebhookIdentity({
						provider: "discord",
						link: params.link,
					})
					if (Option.isNone(config)) {
						return false
					}

					yield* discordApiClient.deleteWebhookMessage({
						webhookId: config.value.webhookId,
						webhookToken: config.value.webhookToken,
						webhookMessageId: params.externalMessageId,
					})

					return true
				}).pipe(
					Effect.catch((error) =>
						Effect.gen(function* () {
							yield* Effect.logWarning(
								"Discord webhook delete failed; falling back to bot API",
								{
									error: String(error),
								},
							)
							return false
						}),
					),
				)
			},
		)

		const resolveAuthorUserId = Effect.fn("discordSyncWorker.resolveAuthorUserId")(function* (params: {
			provider: ChatSyncProvider
			organizationId: OrganizationId
			externalUserId: ExternalUserId
			displayName: string
			avatarUrl: string | null
			syncAvatarUrl?: boolean
		}) {
			const linkedConnection = yield* integrationConnectionRepo.findActiveUserByExternalAccountId(
				params.organizationId,
				decodeProvider(params.provider),
				params.externalUserId,
			)

			if (Option.isSome(linkedConnection) && linkedConnection.value.userId) {
				return linkedConnection.value.userId
			}

			const shouldSyncAvatarUrl =
				params.syncAvatarUrl !== undefined
					? params.syncAvatarUrl
					: !!(params.avatarUrl && params.avatarUrl.trim())

			return yield* getOrCreateShadowUserId({
				provider: params.provider,
				organizationId: params.organizationId,
				externalUserId: params.externalUserId,
				displayName: params.displayName,
				avatarUrl: params.avatarUrl,
				syncAvatarUrl: shouldSyncAvatarUrl,
			})
		})

		const DISCORD_USER_MENTION_PATTERN = /@\[userId:([^\]]+)\]/g

		const getDiscordMentionFallbackDisplayName = Effect.fn(
			"discordSyncWorker.getDiscordMentionFallbackDisplayName",
		)(function* (userId: UserId) {
			const userOption = yield* userRepo.findById(userId)
			if (Option.isNone(userOption)) {
				return "@unknown-user"
			}

			const user = userOption.value
			const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim()
			if (fullName.length > 0) {
				return `@${fullName}`
			}

			const firstName = user.firstName.trim()
			if (firstName.length > 0) {
				return `@${firstName}`
			}

			return "@unknown-user"
		})

		const translateHazelMentionsForDiscord = Effect.fn(
			"discordSyncWorker.translateHazelMentionsForDiscord",
		)(function* (params: { organizationId: OrganizationId; content: string }) {
			const userIds = [...params.content.matchAll(DISCORD_USER_MENTION_PATTERN)].map(
				(match) => match[1] as UserId,
			)

			if (userIds.length === 0) {
				return params.content
			}

			const replacements = new Map<string, string>()

			for (const userId of new Set(userIds)) {
				const connectionOption = yield* integrationConnectionRepo.findUserConnection(
					params.organizationId,
					userId,
					"discord",
				)

				if (Option.isSome(connectionOption)) {
					const connection = connectionOption.value
					const externalAccountId = connection.externalAccountId?.trim()

					if (connection.status === "active" && externalAccountId) {
						replacements.set(userId, `<@${externalAccountId}>`)
						continue
					}
				}

				const fallbackDisplayName = yield* getDiscordMentionFallbackDisplayName(userId)
				replacements.set(userId, fallbackDisplayName)
			}

			return params.content.replace(
				DISCORD_USER_MENTION_PATTERN,
				(fullMatch, userId: string) => replacements.get(userId) ?? fullMatch,
			)
		})

		const normalizeChannelLinkExternalId = <T extends { externalChannelId: string }>(link: T) => ({
			...link,
			externalChannelId: link.externalChannelId as ExternalChannelId,
		})

		const normalizeMessageLinkExternalId = <T extends { externalMessageId: string }>(messageLink: T) => ({
			...messageLink,
			externalMessageId: messageLink.externalMessageId as ExternalMessageId,
		})

		const resolveExternalMessageId = Effect.fn("discordSyncWorker.resolveExternalMessageId")(
			function* (params: {
				syncConnectionId: SyncConnectionId
				hazelMessageId: MessageId
				preferredChannelLinkId?: SyncChannelLinkId
			}) {
				if (params.preferredChannelLinkId) {
					const preferred = yield* messageLinkRepo.findByHazelMessage(
						params.preferredChannelLinkId,
						params.hazelMessageId,
					)

					if (Option.isSome(preferred)) {
						return Option.some(preferred.value.externalMessageId as ExternalMessageId)
					}
				}

				const links = yield* db.execute((client) =>
					client
						.select({
							externalMessageId: schema.chatSyncMessageLinksTable.externalMessageId,
						})
						.from(schema.chatSyncMessageLinksTable)
						.innerJoin(
							schema.chatSyncChannelLinksTable,
							and(
								eq(
									schema.chatSyncChannelLinksTable.id,
									schema.chatSyncMessageLinksTable.channelLinkId,
								),
								eq(
									schema.chatSyncChannelLinksTable.syncConnectionId,
									params.syncConnectionId,
								),
								isNull(schema.chatSyncChannelLinksTable.deletedAt),
							),
						)
						.where(
							and(
								eq(schema.chatSyncMessageLinksTable.hazelMessageId, params.hazelMessageId),
								isNull(schema.chatSyncMessageLinksTable.deletedAt),
							),
						)
						.limit(1),
				)
				return Option.fromNullishOr(links[0]?.externalMessageId as ExternalMessageId | undefined)
			},
		)

		const resolveHazelMessageId = Effect.fn("discordSyncWorker.resolveHazelMessageId")(
			function* (params: {
				syncConnectionId: SyncConnectionId
				externalMessageId: ExternalMessageId
				preferredChannelLinkId?: SyncChannelLinkId
			}) {
				if (params.preferredChannelLinkId) {
					const preferred = yield* messageLinkRepo.findByExternalMessage(
						params.preferredChannelLinkId,
						params.externalMessageId,
					)

					if (Option.isSome(preferred)) {
						return Option.some(preferred.value.hazelMessageId)
					}
				}

				const links = yield* db.execute((client) =>
					client
						.select({
							hazelMessageId: schema.chatSyncMessageLinksTable.hazelMessageId,
						})
						.from(schema.chatSyncMessageLinksTable)
						.innerJoin(
							schema.chatSyncChannelLinksTable,
							and(
								eq(
									schema.chatSyncChannelLinksTable.id,
									schema.chatSyncMessageLinksTable.channelLinkId,
								),
								eq(
									schema.chatSyncChannelLinksTable.syncConnectionId,
									params.syncConnectionId,
								),
								isNull(schema.chatSyncChannelLinksTable.deletedAt),
							),
						)
						.where(
							and(
								eq(
									schema.chatSyncMessageLinksTable.externalMessageId,
									params.externalMessageId,
								),
								isNull(schema.chatSyncMessageLinksTable.deletedAt),
							),
						)
						.limit(1),
				)
				return Option.fromNullishOr(links[0]?.hazelMessageId)
			},
		)

		const resolveOrCreateOutboundLinkForMessage = Effect.fn(
			"discordSyncWorker.resolveOrCreateOutboundLinkForMessage",
		)(function* (params: {
			syncConnectionId: SyncConnectionId
			provider: ChatSyncProvider
			hazelChannelId: ChannelId
		}) {
			const directLink = yield* channelLinkRepo.findByHazelChannel(
				params.syncConnectionId,
				params.hazelChannelId,
			)

			if (Option.isSome(directLink)) {
				return normalizeChannelLinkExternalId(directLink.value)
			}

			const channelOption = yield* channelRepo.findById(params.hazelChannelId)
			if (Option.isNone(channelOption)) {
				return yield* Effect.fail(
					new DiscordSyncChannelLinkNotFoundError({
						syncConnectionId: params.syncConnectionId,
					}),
				)
			}
			const channel = channelOption.value

			if (channel.type !== "thread" || !channel.parentChannelId) {
				return yield* Effect.fail(
					new DiscordSyncChannelLinkNotFoundError({
						syncConnectionId: params.syncConnectionId,
					}),
				)
			}

			const parentLinkOption = yield* channelLinkRepo.findByHazelChannel(
				params.syncConnectionId,
				channel.parentChannelId,
			)

			if (Option.isNone(parentLinkOption)) {
				return yield* Effect.fail(
					new DiscordSyncChannelLinkNotFoundError({
						syncConnectionId: params.syncConnectionId,
					}),
				)
			}
			const parentLink = parentLinkOption.value

			const rootMessages = yield* db.execute((client) =>
				client
					.select({
						id: schema.messagesTable.id,
					})
					.from(schema.messagesTable)
					.where(
						and(
							eq(schema.messagesTable.threadChannelId, params.hazelChannelId),
							isNull(schema.messagesTable.deletedAt),
						),
					)
					.orderBy(asc(schema.messagesTable.createdAt), asc(schema.messagesTable.id))
					.limit(1),
			)
			const rootMessageId = rootMessages[0]?.id
			if (!rootMessageId) {
				return yield* Effect.fail(
					new DiscordSyncChannelLinkNotFoundError({
						syncConnectionId: params.syncConnectionId,
					}),
				)
			}

			const rootMessageLinkOption = yield* messageLinkRepo.findByHazelMessage(
				parentLink.id,
				rootMessageId,
			)

			if (Option.isNone(rootMessageLinkOption)) {
				return yield* Effect.fail(
					new DiscordSyncChannelLinkNotFoundError({
						syncConnectionId: params.syncConnectionId,
					}),
				)
			}

			const adapter = yield* getProviderAdapter(params.provider)
			const externalThreadId = yield* adapter.createThread({
				externalChannelId: normalizeChannelLinkExternalId(parentLink).externalChannelId,
				externalMessageId: normalizeMessageLinkExternalId(rootMessageLinkOption.value)
					.externalMessageId,
				name: channel.name,
			})
			const externalThreadChannelId = externalThreadId as unknown as ExternalChannelId

			const existingThreadLink = yield* channelLinkRepo.findByExternalChannel(
				params.syncConnectionId,
				externalThreadChannelId,
			)

			if (Option.isSome(existingThreadLink)) {
				return normalizeChannelLinkExternalId(existingThreadLink.value)
			}

			const [threadLink] = yield* channelLinkRepo.insert({
				syncConnectionId: params.syncConnectionId,
				hazelChannelId: channel.id,
				externalChannelId: externalThreadChannelId,
				externalChannelName: channel.name,
				direction: parentLink.direction,
				isActive: true,
				settings: parentLink.settings,
				lastSyncedAt: null,
				deletedAt: null,
			})

			yield* channelAccessSyncService.syncChannel(channel.id)
			return normalizeChannelLinkExternalId(threadLink)
		})

		const syncHazelMessageToProvider = Effect.fn("discordSyncWorker.syncHazelMessageToProvider")(
			function* (
				syncConnectionId: SyncConnectionId,
				hazelMessageId: MessageId,
				dedupeKeyOverride?: string,
			) {
				const dedupeKey = dedupeKeyOverride ?? `hazel:message:create:${hazelMessageId}`
				const claimed = yield* claimReceipt({ syncConnectionId, source: "hazel", dedupeKey })
				if (!claimed) {
					return { status: "deduped" as const }
				}

				const connectionOption = yield* connectionRepo.findById(syncConnectionId)

				if (Option.isNone(connectionOption)) {
					return yield* Effect.fail(
						new DiscordSyncConnectionNotFoundError({
							syncConnectionId,
						}),
					)
				}
				const connection = connectionOption.value

				const messageOption = yield* messageRepo.findById(hazelMessageId)
				if (Option.isNone(messageOption)) {
					return yield* Effect.fail(
						new DiscordSyncMessageNotFoundError({
							messageId: hazelMessageId,
						}),
					)
				}
				const message = messageOption.value
				const adapter = yield* getProviderAdapter(connection.provider)
				const link = yield* resolveOrCreateOutboundLinkForMessage({
					syncConnectionId,
					provider: connection.provider,
					hazelChannelId: message.channelId,
				})
				const normalizedLink = normalizeChannelLinkExternalId(link)

				const existingMessageLink = yield* messageLinkRepo.findByHazelMessage(link.id, hazelMessageId)

				if (Option.isSome(existingMessageLink)) {
					yield* writeReceipt({
						syncConnectionId,
						channelLinkId: link.id,
						source: "hazel",
						dedupeKey,
						status: "ignored",
					})
					return { status: "already_linked" as const }
				}

				const replyToExternalMessageId = message.replyToMessageId
					? yield* resolveExternalMessageId({
							syncConnectionId,
							hazelMessageId: message.replyToMessageId,
							preferredChannelLinkId: link.id,
						}).pipe(
							Effect.map((id) =>
								Option.match(id, {
									onNone: () => undefined,
									onSome: (value) => value as ExternalMessageId,
								}),
							),
						)
					: undefined
				const attachments = yield* listMessageAttachmentsForOutboundSync(message.id)
				const outboundContent =
					connection.provider === "discord"
						? yield* translateHazelMentionsForDiscord({
								organizationId: connection.organizationId,
								content: message.content,
							})
						: message.content

				let externalMessageId: ExternalMessageId
				if (connection.provider === "discord") {
					const webhookMessageId = yield* sendDiscordMessageViaWebhook({
						link: {
							id: normalizedLink.id,
							externalChannelId: normalizedLink.externalChannelId,
							settings: link.settings,
						},
						message: {
							authorId: message.authorId,
						},
						content: outboundContent,
						attachments,
						replyToExternalMessageId,
					})

					if (Option.isSome(webhookMessageId)) {
						externalMessageId = webhookMessageId.value
					} else if (attachments.length > 0) {
						externalMessageId = yield* adapter.createMessageWithAttachments({
							externalChannelId: normalizedLink.externalChannelId,
							content: outboundContent,
							attachments,
							replyToExternalMessageId,
						})
					} else {
						externalMessageId = yield* adapter.createMessage({
							externalChannelId: normalizedLink.externalChannelId,
							content: outboundContent,
							replyToExternalMessageId,
						})
					}
				} else if (attachments.length > 0) {
					externalMessageId = yield* adapter.createMessageWithAttachments({
						externalChannelId: normalizedLink.externalChannelId,
						content: message.content,
						attachments,
						replyToExternalMessageId,
					})
				} else {
					externalMessageId = yield* adapter.createMessage({
						externalChannelId: normalizedLink.externalChannelId,
						content: message.content,
						replyToExternalMessageId,
					})
				}

				yield* messageLinkRepo.insert({
					channelLinkId: link.id,
					hazelMessageId: message.id,
					externalMessageId,
					source: "hazel",
					rootHazelMessageId: null,
					rootExternalMessageId: null,
					hazelThreadChannelId: message.threadChannelId,
					externalThreadId: null,
					deletedAt: null,
				})

				yield* writeReceipt({
					syncConnectionId,
					channelLinkId: link.id,
					source: "hazel",
					dedupeKey,
					payload: {
						hazelMessageId,
						externalMessageId,
					},
				})
				yield* connectionRepo.updateLastSyncedAt(syncConnectionId)
				yield* channelLinkRepo.updateLastSyncedAt(link.id)

				return { status: "synced" as const, externalMessageId }
			},
		)

		const syncConnection = Effect.fn("discordSyncWorker.syncConnection")(function* (
			syncConnectionId: SyncConnectionId,
			maxMessagesPerChannel = DEFAULT_MAX_MESSAGES_PER_CHANNEL,
		) {
			const connectionOption = yield* connectionRepo.findById(syncConnectionId)
			if (Option.isNone(connectionOption)) {
				return yield* Effect.fail(
					new DiscordSyncConnectionNotFoundError({
						syncConnectionId,
					}),
				)
			}
			const connection = connectionOption.value
			if (connection.status !== "active") {
				return { sent: 0, skipped: 0, failed: 0 }
			}

			const links = yield* channelLinkRepo.findActiveBySyncConnection(syncConnectionId)

			let sent = 0
			let skipped = 0
			let failed = 0

			for (const link of links) {
				const unsyncedMessages = yield* db.execute((client) =>
					client
						.select({
							id: schema.messagesTable.id,
						})
						.from(schema.messagesTable)
						.leftJoin(
							schema.chatSyncMessageLinksTable,
							and(
								eq(schema.chatSyncMessageLinksTable.channelLinkId, link.id),
								eq(schema.chatSyncMessageLinksTable.hazelMessageId, schema.messagesTable.id),
								isNull(schema.chatSyncMessageLinksTable.deletedAt),
							),
						)
						.where(
							and(
								eq(schema.messagesTable.channelId, link.hazelChannelId),
								isNull(schema.messagesTable.deletedAt),
								isNull(schema.chatSyncMessageLinksTable.id),
							),
						)
						.orderBy(asc(schema.messagesTable.createdAt), asc(schema.messagesTable.id))
						.limit(maxMessagesPerChannel),
				)

				for (const unsyncedMessage of unsyncedMessages) {
					const result = yield* syncHazelMessageToProvider(
						syncConnectionId,
						unsyncedMessage.id,
					).pipe(Effect.result)
					if (result._tag === "Success") {
						if (result.success.status === "synced") {
							sent++
						} else {
							skipped++
						}
					} else {
						failed++
						yield* Effect.logWarning("Failed to sync Hazel message to provider", {
							provider: connection.provider,
							syncConnectionId,
							hazelMessageId: unsyncedMessage.id,
							error: result.failure,
						})
					}
				}
			}

			return { sent, skipped, failed }
		})

		const syncHazelMessageUpdateToProvider = Effect.fn(
			"discordSyncWorker.syncHazelMessageUpdateToProvider",
		)(function* (
			syncConnectionId: SyncConnectionId,
			hazelMessageId: MessageId,
			dedupeKeyOverride?: string,
		) {
			const dedupeKey = dedupeKeyOverride ?? `hazel:message:update:${hazelMessageId}`
			const claimed = yield* claimReceipt({ syncConnectionId, source: "hazel", dedupeKey })
			if (!claimed) {
				return { status: "deduped" as const }
			}

			const connectionOption = yield* connectionRepo.findById(syncConnectionId)
			if (Option.isNone(connectionOption)) {
				return yield* Effect.fail(
					new DiscordSyncConnectionNotFoundError({
						syncConnectionId,
					}),
				)
			}
			const connection = connectionOption.value
			const adapter = yield* getProviderAdapter(connection.provider)

			const messageOption = yield* messageRepo.findById(hazelMessageId)
			if (Option.isNone(messageOption)) {
				return yield* Effect.fail(new DiscordSyncMessageNotFoundError({ messageId: hazelMessageId }))
			}
			const message = messageOption.value

			const link = yield* resolveOrCreateOutboundLinkForMessage({
				syncConnectionId,
				provider: connection.provider,
				hazelChannelId: message.channelId,
			})
			const normalizedLink = normalizeChannelLinkExternalId(link)

			const messageLinkOption = yield* messageLinkRepo.findByHazelMessage(link.id, hazelMessageId)

			if (Option.isNone(messageLinkOption)) {
				yield* writeReceipt({
					syncConnectionId,
					channelLinkId: link.id,
					source: "hazel",
					dedupeKey,
					status: "ignored",
					payload: { hazelMessageId },
				})
				return { status: "ignored_missing_link" as const }
			}
			const messageLink = messageLinkOption.value
			const normalizedMessageLink = normalizeMessageLinkExternalId(messageLink)
			const outboundContent =
				connection.provider === "discord"
					? yield* translateHazelMentionsForDiscord({
							organizationId: connection.organizationId,
							content: message.content,
						})
					: message.content

			if (connection.provider !== "discord") {
				yield* adapter.updateMessage({
					externalChannelId: normalizedLink.externalChannelId,
					externalMessageId: normalizedMessageLink.externalMessageId,
					content: outboundContent,
				})
			} else {
				const updated = yield* updateDiscordMessageViaWebhook({
					link: {
						id: normalizedLink.id,
						externalChannelId: normalizedLink.externalChannelId,
						settings: link.settings,
					},
					externalMessageId: normalizedMessageLink.externalMessageId,
					content: outboundContent,
				})

				if (!updated) {
					yield* adapter.updateMessage({
						externalChannelId: normalizedLink.externalChannelId,
						externalMessageId: normalizedMessageLink.externalMessageId,
						content: outboundContent,
					})
				}
			}

			yield* messageLinkRepo.updateLastSyncedAt(messageLink.id)
			yield* writeReceipt({
				syncConnectionId,
				channelLinkId: link.id,
				source: "hazel",
				dedupeKey,
				payload: {
					hazelMessageId,
					externalMessageId: normalizedMessageLink.externalMessageId,
				},
			})
			yield* connectionRepo.updateLastSyncedAt(syncConnectionId)
			yield* channelLinkRepo.updateLastSyncedAt(link.id)

			return {
				status: "updated" as const,
				externalMessageId: normalizedMessageLink.externalMessageId,
			}
		})

		const syncHazelMessageDeleteToProvider = Effect.fn(
			"discordSyncWorker.syncHazelMessageDeleteToProvider",
		)(function* (
			syncConnectionId: SyncConnectionId,
			hazelMessageId: MessageId,
			dedupeKeyOverride?: string,
		) {
			const dedupeKey = dedupeKeyOverride ?? `hazel:message:delete:${hazelMessageId}`
			const claimed = yield* claimReceipt({ syncConnectionId, source: "hazel", dedupeKey })
			if (!claimed) {
				return { status: "deduped" as const }
			}

			const connectionOption = yield* connectionRepo.findById(syncConnectionId)
			if (Option.isNone(connectionOption)) {
				return yield* Effect.fail(
					new DiscordSyncConnectionNotFoundError({
						syncConnectionId,
					}),
				)
			}
			const connection = connectionOption.value
			const adapter = yield* getProviderAdapter(connection.provider)

			const messageOption = yield* messageRepo.findById(hazelMessageId)
			if (Option.isNone(messageOption)) {
				return yield* Effect.fail(new DiscordSyncMessageNotFoundError({ messageId: hazelMessageId }))
			}
			const message = messageOption.value

			const link = yield* resolveOrCreateOutboundLinkForMessage({
				syncConnectionId,
				provider: connection.provider,
				hazelChannelId: message.channelId,
			})
			const normalizedLink = normalizeChannelLinkExternalId(link)

			const messageLinkOption = yield* messageLinkRepo.findByHazelMessage(link.id, hazelMessageId)

			if (Option.isNone(messageLinkOption)) {
				yield* writeReceipt({
					syncConnectionId,
					channelLinkId: link.id,
					source: "hazel",
					dedupeKey,
					status: "ignored",
					payload: { hazelMessageId },
				})
				return { status: "ignored_missing_link" as const }
			}
			const messageLink = messageLinkOption.value
			const normalizedMessageLink = normalizeMessageLinkExternalId(messageLink)

			if (connection.provider !== "discord") {
				yield* adapter.deleteMessage({
					externalChannelId: normalizedLink.externalChannelId,
					externalMessageId: normalizedMessageLink.externalMessageId,
				})
			} else {
				const deleted = yield* deleteDiscordMessageViaWebhook({
					link: {
						id: normalizedLink.id,
						externalChannelId: normalizedLink.externalChannelId,
						settings: link.settings,
					},
					externalMessageId: normalizedMessageLink.externalMessageId,
				})

				if (!deleted) {
					yield* adapter.deleteMessage({
						externalChannelId: normalizedLink.externalChannelId,
						externalMessageId: normalizedMessageLink.externalMessageId,
					})
				}
			}

			yield* messageLinkRepo.softDelete(messageLink.id)
			yield* writeReceipt({
				syncConnectionId,
				channelLinkId: link.id,
				source: "hazel",
				dedupeKey,
				payload: {
					hazelMessageId,
					externalMessageId: normalizedMessageLink.externalMessageId,
				},
			})
			yield* connectionRepo.updateLastSyncedAt(syncConnectionId)
			yield* channelLinkRepo.updateLastSyncedAt(link.id)

			return {
				status: "deleted" as const,
				externalMessageId: normalizedMessageLink.externalMessageId,
			}
		})

		const syncHazelReactionCreateToProvider = Effect.fn(
			"discordSyncWorker.syncHazelReactionCreateToProvider",
		)(function* (
			syncConnectionId: SyncConnectionId,
			hazelReactionId: MessageReactionId,
			dedupeKeyOverride?: string,
		) {
			const dedupeKey = dedupeKeyOverride ?? `hazel:reaction:create:${hazelReactionId}`
			const claimed = yield* claimReceipt({ syncConnectionId, source: "hazel", dedupeKey })
			if (!claimed) {
				return { status: "deduped" as const }
			}

			const connectionOption = yield* connectionRepo.findById(syncConnectionId)
			if (Option.isNone(connectionOption)) {
				return yield* Effect.fail(
					new DiscordSyncConnectionNotFoundError({
						syncConnectionId,
					}),
				)
			}
			const connection = connectionOption.value
			const adapter = yield* getProviderAdapter(connection.provider)

			const reactionOption = yield* messageReactionRepo.findById(hazelReactionId)
			if (Option.isNone(reactionOption)) {
				yield* writeReceipt({
					syncConnectionId,
					source: "hazel",
					dedupeKey,
					status: "ignored",
				})
				return { status: "ignored_missing_reaction" as const }
			}
			const reaction = reactionOption.value

			const link = yield* resolveOrCreateOutboundLinkForMessage({
				syncConnectionId,
				provider: connection.provider,
				hazelChannelId: reaction.channelId,
			})
			const normalizedLink = normalizeChannelLinkExternalId(link)

			const messageLinkOption = yield* messageLinkRepo.findByHazelMessage(link.id, reaction.messageId)

			if (Option.isNone(messageLinkOption)) {
				yield* writeReceipt({
					syncConnectionId,
					channelLinkId: link.id,
					source: "hazel",
					dedupeKey,
					status: "ignored",
					payload: {
						hazelReactionId,
					},
				})
				return { status: "ignored_missing_link" as const }
			}
			const messageLink = messageLinkOption.value
			const normalizedMessageLink = normalizeMessageLinkExternalId(messageLink)

			yield* adapter.addReaction({
				externalChannelId: normalizedLink.externalChannelId,
				externalMessageId: normalizedMessageLink.externalMessageId,
				emoji: reaction.emoji,
			})

			yield* writeReceipt({
				syncConnectionId,
				channelLinkId: link.id,
				source: "hazel",
				dedupeKey,
				payload: {
					hazelReactionId,
					externalMessageId: normalizedMessageLink.externalMessageId,
					emoji: reaction.emoji,
				},
			})
			yield* connectionRepo.updateLastSyncedAt(syncConnectionId)
			yield* channelLinkRepo.updateLastSyncedAt(link.id)

			return {
				status: "created" as const,
				externalMessageId: normalizedMessageLink.externalMessageId,
			}
		})

		const syncHazelReactionDeleteToProvider = Effect.fn(
			"discordSyncWorker.syncHazelReactionDeleteToProvider",
		)(function* (
			syncConnectionId: SyncConnectionId,
			payload: {
				hazelChannelId: ChannelId
				hazelMessageId: MessageId
				emoji: string
				userId?: UserId
			},
			dedupeKeyOverride?: string,
		) {
			const dedupeKey =
				dedupeKeyOverride ??
				`hazel:reaction:delete:${payload.hazelMessageId}:${payload.emoji}:${payload.userId ?? "unknown"}`
			const claimed = yield* claimReceipt({ syncConnectionId, source: "hazel", dedupeKey })
			if (!claimed) {
				return { status: "deduped" as const }
			}

			const connectionOption = yield* connectionRepo.findById(syncConnectionId)
			if (Option.isNone(connectionOption)) {
				return yield* Effect.fail(
					new DiscordSyncConnectionNotFoundError({
						syncConnectionId,
					}),
				)
			}
			const connection = connectionOption.value
			const adapter = yield* getProviderAdapter(connection.provider)

			const link = yield* resolveOrCreateOutboundLinkForMessage({
				syncConnectionId,
				provider: connection.provider,
				hazelChannelId: payload.hazelChannelId,
			})
			const normalizedLink = normalizeChannelLinkExternalId(link)

			const messageLinkOption = yield* messageLinkRepo.findByHazelMessage(
				link.id,
				payload.hazelMessageId,
			)

			if (Option.isNone(messageLinkOption)) {
				yield* writeReceipt({
					syncConnectionId,
					channelLinkId: link.id,
					source: "hazel",
					dedupeKey,
					status: "ignored",
					payload,
				})
				return { status: "ignored_missing_link" as const }
			}
			const messageLink = messageLinkOption.value
			const normalizedMessageLink = normalizeMessageLinkExternalId(messageLink)

			const remainingReactions = yield* db.execute((client) =>
				client
					.select({
						id: schema.messageReactionsTable.id,
					})
					.from(schema.messageReactionsTable)
					.where(
						and(
							eq(schema.messageReactionsTable.messageId, payload.hazelMessageId),
							eq(schema.messageReactionsTable.emoji, payload.emoji),
						),
					)
					.limit(1),
			)
			if (remainingReactions.length > 0) {
				yield* writeReceipt({
					syncConnectionId,
					channelLinkId: link.id,
					source: "hazel",
					dedupeKey,
					status: "ignored",
					payload: {
						...payload,
						reason: "remaining_reactions_for_emoji",
					},
				})
				return { status: "ignored_remaining_reactions" as const }
			}

			yield* adapter.removeReaction({
				externalChannelId: normalizedLink.externalChannelId,
				externalMessageId: normalizedMessageLink.externalMessageId,
				emoji: payload.emoji,
			})

			yield* writeReceipt({
				syncConnectionId,
				channelLinkId: link.id,
				source: "hazel",
				dedupeKey,
				payload: {
					...payload,
					externalMessageId: normalizedMessageLink.externalMessageId,
				},
			})
			yield* connectionRepo.updateLastSyncedAt(syncConnectionId)
			yield* channelLinkRepo.updateLastSyncedAt(link.id)

			return {
				status: "deleted" as const,
				externalMessageId: normalizedMessageLink.externalMessageId,
			}
		})

		const getActiveOutboundTargets = Effect.fn("discordSyncWorker.getActiveOutboundTargets")(function* (
			hazelChannelId: ChannelId,
			provider: ChatSyncProvider,
		) {
			const targets = yield* db.execute((client) =>
				client
					.select({
						syncConnectionId: schema.chatSyncConnectionsTable.id,
						channelLinkId: schema.chatSyncChannelLinksTable.id,
						direction: schema.chatSyncChannelLinksTable.direction,
					})
					.from(schema.chatSyncChannelLinksTable)
					.innerJoin(
						schema.chatSyncConnectionsTable,
						eq(
							schema.chatSyncConnectionsTable.id,
							schema.chatSyncChannelLinksTable.syncConnectionId,
						),
					)
					.where(
						and(
							eq(schema.chatSyncChannelLinksTable.hazelChannelId, hazelChannelId),
							eq(schema.chatSyncChannelLinksTable.isActive, true),
							isNull(schema.chatSyncChannelLinksTable.deletedAt),
							eq(schema.chatSyncConnectionsTable.provider, provider),
							eq(schema.chatSyncConnectionsTable.status, "active"),
							isNull(schema.chatSyncConnectionsTable.deletedAt),
						),
					),
			)
			return targets
		})

		const syncHazelMessageCreateToAllConnections = Effect.fn(
			"discordSyncWorker.syncHazelMessageCreateToAllConnections",
		)(function* (provider: ChatSyncProvider, hazelMessageId: MessageId, dedupeKey?: string) {
			const messageOption = yield* messageRepo.findById(hazelMessageId)
			if (Option.isNone(messageOption)) {
				return { synced: 0, failed: 0 }
			}
			const targets = yield* getActiveOutboundTargets(messageOption.value.channelId, provider)
			let synced = 0
			let failed = 0

			for (const target of targets) {
				if (target.direction === "external_to_hazel") continue
				const result = yield* syncHazelMessageToProvider(
					target.syncConnectionId,
					hazelMessageId,
					dedupeKey,
				).pipe(Effect.result)
				if (result._tag === "Success") {
					if (result.success.status === "synced" || result.success.status === "already_linked") {
						synced++
					}
				} else {
					failed++
					yield* Effect.logWarning("Failed to sync create message to provider", {
						provider,
						hazelMessageId,
						syncConnectionId: target.syncConnectionId,
						error: result.failure,
					})
				}
			}

			return { synced, failed }
		})

		const syncHazelMessageUpdateToAllConnections = Effect.fn(
			"discordSyncWorker.syncHazelMessageUpdateToAllConnections",
		)(function* (provider: ChatSyncProvider, hazelMessageId: MessageId, dedupeKey?: string) {
			const messageOption = yield* messageRepo.findById(hazelMessageId)
			if (Option.isNone(messageOption)) {
				return { synced: 0, failed: 0 }
			}
			const targets = yield* getActiveOutboundTargets(messageOption.value.channelId, provider)
			let synced = 0
			let failed = 0

			for (const target of targets) {
				if (target.direction === "external_to_hazel") continue
				const result = yield* syncHazelMessageUpdateToProvider(
					target.syncConnectionId,
					hazelMessageId,
					dedupeKey,
				).pipe(Effect.result)
				if (result._tag === "Success") {
					if (result.success.status === "updated") {
						synced++
					}
				} else {
					failed++
					yield* Effect.logWarning("Failed to sync update message to provider", {
						provider,
						hazelMessageId,
						syncConnectionId: target.syncConnectionId,
						error: result.failure,
					})
				}
			}

			return { synced, failed }
		})

		const syncHazelMessageDeleteToAllConnections = Effect.fn(
			"discordSyncWorker.syncHazelMessageDeleteToAllConnections",
		)(function* (provider: ChatSyncProvider, hazelMessageId: MessageId, dedupeKey?: string) {
			const messageOption = yield* messageRepo.findById(hazelMessageId)
			if (Option.isNone(messageOption)) {
				return { synced: 0, failed: 0 }
			}
			const targets = yield* getActiveOutboundTargets(messageOption.value.channelId, provider)
			let synced = 0
			let failed = 0

			for (const target of targets) {
				if (target.direction === "external_to_hazel") continue
				const result = yield* syncHazelMessageDeleteToProvider(
					target.syncConnectionId,
					hazelMessageId,
					dedupeKey,
				).pipe(Effect.result)
				if (result._tag === "Success") {
					if (result.success.status === "deleted") {
						synced++
					}
				} else {
					failed++
					yield* Effect.logWarning("Failed to sync delete message to provider", {
						provider,
						hazelMessageId,
						syncConnectionId: target.syncConnectionId,
						error: result.failure,
					})
				}
			}

			return { synced, failed }
		})

		const syncHazelReactionCreateToAllConnections = Effect.fn(
			"discordSyncWorker.syncHazelReactionCreateToAllConnections",
		)(function* (provider: ChatSyncProvider, hazelReactionId: MessageReactionId, dedupeKey?: string) {
			const reactionOption = yield* messageReactionRepo.findById(hazelReactionId)
			if (Option.isNone(reactionOption)) {
				return { synced: 0, failed: 0 }
			}
			const reaction = reactionOption.value
			const targets = yield* getActiveOutboundTargets(reaction.channelId, provider)
			let synced = 0
			let failed = 0

			for (const target of targets) {
				if (target.direction === "external_to_hazel") continue
				const result = yield* syncHazelReactionCreateToProvider(
					target.syncConnectionId,
					hazelReactionId,
					dedupeKey,
				).pipe(Effect.result)
				if (result._tag === "Success") {
					if (result.success.status === "created") {
						synced++
					}
				} else {
					failed++
					yield* Effect.logWarning("Failed to sync create reaction to provider", {
						provider,
						hazelReactionId,
						syncConnectionId: target.syncConnectionId,
						error: result.failure,
					})
				}
			}

			return { synced, failed }
		})

		const syncHazelReactionDeleteToAllConnections = Effect.fn(
			"discordSyncWorker.syncHazelReactionDeleteToAllConnections",
		)(function* (
			provider: ChatSyncProvider,
			payload: {
				hazelChannelId: ChannelId
				hazelMessageId: MessageId
				emoji: string
				userId?: UserId
			},
			dedupeKey?: string,
		) {
			const targets = yield* getActiveOutboundTargets(payload.hazelChannelId, provider)
			let synced = 0
			let failed = 0

			for (const target of targets) {
				if (target.direction === "external_to_hazel") continue
				const result = yield* syncHazelReactionDeleteToProvider(
					target.syncConnectionId,
					payload,
					dedupeKey,
				).pipe(Effect.result)
				if (result._tag === "Success") {
					if (result.success.status === "deleted") {
						synced++
					}
				} else {
					failed++
					yield* Effect.logWarning("Failed to sync delete reaction to provider", {
						provider,
						hazelMessageId: payload.hazelMessageId,
						syncConnectionId: target.syncConnectionId,
						error: result.failure,
					})
				}
			}

			return { synced, failed }
		})

		const syncAllActiveConnections = Effect.fn("discordSyncWorker.syncAllActiveConnections")(function* (
			provider: ChatSyncProvider,
			maxMessagesPerChannel = DEFAULT_MAX_MESSAGES_PER_CHANNEL,
		) {
			const connections = yield* connectionRepo.findActiveByProvider(provider)
			return yield* Effect.forEach(
				connections,
				(connection) =>
					syncConnection(connection.id, maxMessagesPerChannel).pipe(
						Effect.map((summary) => ({
							syncConnectionId: connection.id,
							...summary,
						})),
					),
				{ concurrency: DEFAULT_CHAT_SYNC_CONCURRENCY },
			)
		})

		const ingestMessageCreate = Effect.fn("discordSyncWorker.ingestMessageCreate")(function* (
			payload: ChatSyncIngressMessageCreate,
		) {
			const dedupeKey = payload.dedupeKey ?? `external:message:create:${payload.externalMessageId}`
			const claimed = yield* claimReceipt({
				syncConnectionId: payload.syncConnectionId,
				source: "external",
				dedupeKey,
			})
			if (!claimed) {
				return { status: "deduped" as const }
			}

			const connectionOption = yield* connectionRepo.findById(payload.syncConnectionId)

			if (Option.isNone(connectionOption)) {
				return yield* Effect.fail(
					new DiscordSyncConnectionNotFoundError({
						syncConnectionId: payload.syncConnectionId,
					}),
				)
			}
			const connection = connectionOption.value
			if (connection.status !== "active") {
				yield* writeReceipt({
					syncConnectionId: payload.syncConnectionId,
					source: "external",
					dedupeKey,
					status: "ignored",
					payload,
				})
				return { status: "ignored_connection_inactive" as const }
			}
			yield* getProviderAdapter(connection.provider)

			const linkOption = yield* channelLinkRepo.findByExternalChannel(
				payload.syncConnectionId,
				payload.externalChannelId,
			)

			if (Option.isNone(linkOption)) {
				return yield* Effect.fail(
					new DiscordSyncChannelLinkNotFoundError({
						syncConnectionId: payload.syncConnectionId,
						externalChannelId: payload.externalChannelId,
					}),
				)
			}
			const link = linkOption.value
			if (shouldIgnoreWebhookOrigin(connection.provider, link.settings, payload.externalWebhookId)) {
				yield* writeReceipt({
					syncConnectionId: payload.syncConnectionId,
					channelLinkId: link.id,
					source: "external",
					dedupeKey,
					status: "ignored",
					payload,
				})
				return { status: "ignored_webhook_origin" as const }
			}

			const existingMessageLink = yield* messageLinkRepo.findByExternalMessage(
				link.id,
				payload.externalMessageId,
			)

			if (Option.isSome(existingMessageLink)) {
				yield* writeReceipt({
					syncConnectionId: payload.syncConnectionId,
					channelLinkId: link.id,
					source: "external",
					dedupeKey,
					status: "ignored",
				})
				return { status: "already_linked" as const }
			}

			const authorId = payload.externalAuthorId
				? yield* resolveAuthorUserId({
						provider: connection.provider,
						organizationId: connection.organizationId,
						externalUserId: payload.externalAuthorId,
						displayName: payload.externalAuthorDisplayName ?? "External User",
						avatarUrl: payload.externalAuthorAvatarUrl ?? null,
					})
				: (yield* integrationBotService.getOrCreateBotUser(
						decodeProvider(connection.provider),
						connection.organizationId,
					)).id
			const replyToMessageId = payload.externalReplyToMessageId
				? yield* resolveHazelMessageId({
						syncConnectionId: payload.syncConnectionId,
						externalMessageId: payload.externalReplyToMessageId,
						preferredChannelLinkId: link.id,
					}).pipe(
						Effect.map((id) =>
							Option.match(id, {
								onNone: () => null,
								onSome: (value) => value,
							}),
						),
					)
				: null
			const normalizedExternalAttachments: Array<ChatSyncIngressMessageAttachment> = []
			for (const attachment of payload.externalAttachments ?? []) {
				const fileName = attachment.fileName.trim()
				const publicUrl = attachment.publicUrl.trim()
				if (!fileName || !publicUrl) {
					continue
				}
				normalizedExternalAttachments.push({
					externalAttachmentId: attachment.externalAttachmentId,
					fileName,
					fileSize:
						Number.isFinite(attachment.fileSize) && attachment.fileSize >= 0
							? attachment.fileSize
							: 0,
					publicUrl,
				})
			}
			const message = yield* db.transaction(
				Effect.gen(function* () {
					const [createdMessage] = yield* messageRepo.insert({
						channelId: link.hazelChannelId,
						authorId,
						content: payload.content,
						embeds: null,
						replyToMessageId,
						threadChannelId: null,
						deletedAt: null,
					})

					yield* outboxRepo.insert({
						eventType: "message_created",
						aggregateId: createdMessage.id,
						channelId: createdMessage.channelId,
						payload: {
							messageId: createdMessage.id,
							channelId: createdMessage.channelId,
							authorId: createdMessage.authorId,
							content: createdMessage.content,
							replyToMessageId: createdMessage.replyToMessageId,
						},
					})

					if (normalizedExternalAttachments.length > 0) {
						const uploadedAtBase = Date.now()
						yield* transactionAwareExecute((client) =>
							client.insert(schema.attachmentsTable).values(
								normalizedExternalAttachments.map((attachment, index) => ({
									organizationId: connection.organizationId,
									channelId: link.hazelChannelId,
									messageId: createdMessage.id,
									fileName: attachment.fileName,
									fileSize: attachment.fileSize,
									externalUrl: attachment.publicUrl,
									uploadedBy: authorId,
									status: "complete" as const,
									uploadedAt: new Date(uploadedAtBase + index),
									deletedAt: null,
								})),
							),
						)
					}

					yield* messageLinkRepo.insert({
						channelLinkId: link.id,
						hazelMessageId: createdMessage.id,
						externalMessageId: payload.externalMessageId,
						source: "external",
						rootHazelMessageId: null,
						rootExternalMessageId: null,
						hazelThreadChannelId: createdMessage.threadChannelId,
						externalThreadId: payload.externalThreadId ?? null,
						deletedAt: null,
					})

					return createdMessage
				}),
			)

			yield* writeReceipt({
				syncConnectionId: payload.syncConnectionId,
				channelLinkId: link.id,
				source: "external",
				dedupeKey,
				payload,
			})
			yield* connectionRepo.updateLastSyncedAt(payload.syncConnectionId)
			yield* channelLinkRepo.updateLastSyncedAt(link.id)

			return { status: "created" as const, hazelMessageId: message.id }
		})

		const ingestMessageUpdate = Effect.fn("discordSyncWorker.ingestMessageUpdate")(function* (
			payload: ChatSyncIngressMessageUpdate,
		) {
			const dedupeKey = payload.dedupeKey ?? `external:message:update:${payload.externalMessageId}`
			const claimed = yield* claimReceipt({
				syncConnectionId: payload.syncConnectionId,
				source: "external",
				dedupeKey,
			})
			if (!claimed) {
				return { status: "deduped" as const }
			}

			const connectionOption = yield* connectionRepo.findById(payload.syncConnectionId)

			if (Option.isNone(connectionOption)) {
				return yield* Effect.fail(
					new DiscordSyncConnectionNotFoundError({
						syncConnectionId: payload.syncConnectionId,
					}),
				)
			}
			const connection = connectionOption.value
			if (connection.status !== "active") {
				yield* writeReceipt({
					syncConnectionId: payload.syncConnectionId,
					source: "external",
					dedupeKey,
					status: "ignored",
					payload,
				})
				return { status: "ignored_connection_inactive" as const }
			}
			yield* getProviderAdapter(connection.provider)

			const linkOption = yield* channelLinkRepo.findByExternalChannel(
				payload.syncConnectionId,
				payload.externalChannelId,
			)

			if (Option.isNone(linkOption)) {
				return yield* Effect.fail(
					new DiscordSyncChannelLinkNotFoundError({
						syncConnectionId: payload.syncConnectionId,
						externalChannelId: payload.externalChannelId,
					}),
				)
			}
			const link = linkOption.value
			if (shouldIgnoreWebhookOrigin(connection.provider, link.settings, payload.externalWebhookId)) {
				yield* writeReceipt({
					syncConnectionId: payload.syncConnectionId,
					channelLinkId: link.id,
					source: "external",
					dedupeKey,
					status: "ignored",
					payload,
				})
				return { status: "ignored_webhook_origin" as const }
			}

			const messageLinkOption = yield* messageLinkRepo.findByExternalMessage(
				link.id,
				payload.externalMessageId,
			)

			if (Option.isNone(messageLinkOption)) {
				yield* writeReceipt({
					syncConnectionId: payload.syncConnectionId,
					channelLinkId: link.id,
					source: "external",
					dedupeKey,
					status: "ignored",
					payload,
				})
				return { status: "ignored_missing_link" as const }
			}
			const messageLink = messageLinkOption.value

			yield* db.transaction(
				Effect.gen(function* () {
					const updatedMessage = yield* messageRepo.update({
						id: messageLink.hazelMessageId,
						content: payload.content,
						updatedAt: new Date(),
					})
					yield* outboxRepo.insert({
						eventType: "message_updated",
						aggregateId: updatedMessage.id,
						channelId: updatedMessage.channelId,
						payload: {
							messageId: updatedMessage.id,
						},
					})
				}),
			)

			yield* writeReceipt({
				syncConnectionId: payload.syncConnectionId,
				channelLinkId: link.id,
				source: "external",
				dedupeKey,
				payload,
			})
			yield* connectionRepo.updateLastSyncedAt(payload.syncConnectionId)
			yield* channelLinkRepo.updateLastSyncedAt(link.id)

			return { status: "updated" as const, hazelMessageId: messageLink.hazelMessageId }
		})

		const ingestMessageDelete = Effect.fn("discordSyncWorker.ingestMessageDelete")(function* (
			payload: ChatSyncIngressMessageDelete,
		) {
			const dedupeKey = payload.dedupeKey ?? `external:message:delete:${payload.externalMessageId}`
			const claimed = yield* claimReceipt({
				syncConnectionId: payload.syncConnectionId,
				source: "external",
				dedupeKey,
			})
			if (!claimed) {
				return { status: "deduped" as const }
			}

			const connectionOption = yield* connectionRepo.findById(payload.syncConnectionId)

			if (Option.isNone(connectionOption)) {
				return yield* Effect.fail(
					new DiscordSyncConnectionNotFoundError({
						syncConnectionId: payload.syncConnectionId,
					}),
				)
			}
			const connection = connectionOption.value
			if (connection.status !== "active") {
				yield* writeReceipt({
					syncConnectionId: payload.syncConnectionId,
					source: "external",
					dedupeKey,
					status: "ignored",
					payload,
				})
				return { status: "ignored_connection_inactive" as const }
			}
			yield* getProviderAdapter(connection.provider)

			const linkOption = yield* channelLinkRepo.findByExternalChannel(
				payload.syncConnectionId,
				payload.externalChannelId,
			)

			if (Option.isNone(linkOption)) {
				return yield* Effect.fail(
					new DiscordSyncChannelLinkNotFoundError({
						syncConnectionId: payload.syncConnectionId,
						externalChannelId: payload.externalChannelId,
					}),
				)
			}
			const link = linkOption.value
			if (shouldIgnoreWebhookOrigin(connection.provider, link.settings, payload.externalWebhookId)) {
				yield* writeReceipt({
					syncConnectionId: payload.syncConnectionId,
					channelLinkId: link.id,
					source: "external",
					dedupeKey,
					status: "ignored",
					payload,
				})
				return { status: "ignored_webhook_origin" as const }
			}

			const messageLinkOption = yield* messageLinkRepo.findByExternalMessage(
				link.id,
				payload.externalMessageId,
			)

			if (Option.isNone(messageLinkOption)) {
				yield* writeReceipt({
					syncConnectionId: payload.syncConnectionId,
					channelLinkId: link.id,
					source: "external",
					dedupeKey,
					status: "ignored",
					payload,
				})
				return { status: "ignored_missing_link" as const }
			}
			const messageLink = messageLinkOption.value

			yield* db.transaction(
				Effect.gen(function* () {
					const deletedMessage = yield* messageRepo.update({
						id: messageLink.hazelMessageId,
						deletedAt: new Date(),
						updatedAt: new Date(),
					})
					yield* outboxRepo.insert({
						eventType: "message_deleted",
						aggregateId: deletedMessage.id,
						channelId: deletedMessage.channelId,
						payload: {
							messageId: deletedMessage.id,
							channelId: deletedMessage.channelId,
						},
					})
				}),
			)

			yield* writeReceipt({
				syncConnectionId: payload.syncConnectionId,
				channelLinkId: link.id,
				source: "external",
				dedupeKey,
				payload,
			})
			yield* connectionRepo.updateLastSyncedAt(payload.syncConnectionId)
			yield* channelLinkRepo.updateLastSyncedAt(link.id)

			return { status: "deleted" as const, hazelMessageId: messageLink.hazelMessageId }
		})

		const ingestReactionAdd = Effect.fn("discordSyncWorker.ingestReactionAdd")(function* (
			payload: ChatSyncIngressReactionAdd,
		) {
			const dedupeKey =
				payload.dedupeKey ??
				`external:reaction:add:${payload.externalMessageId}:${payload.externalUserId}:${payload.emoji}`
			const claimed = yield* claimReceipt({
				syncConnectionId: payload.syncConnectionId,
				source: "external",
				dedupeKey,
			})
			if (!claimed) {
				return { status: "deduped" as const }
			}

			const connectionOption = yield* connectionRepo.findById(payload.syncConnectionId)

			if (Option.isNone(connectionOption)) {
				return yield* Effect.fail(
					new DiscordSyncConnectionNotFoundError({
						syncConnectionId: payload.syncConnectionId,
					}),
				)
			}
			const connection = connectionOption.value
			if (connection.status !== "active") {
				yield* writeReceipt({
					syncConnectionId: payload.syncConnectionId,
					source: "external",
					dedupeKey,
					status: "ignored",
					payload,
				})
				return { status: "ignored_connection_inactive" as const }
			}
			yield* getProviderAdapter(connection.provider)

			const linkOption = yield* channelLinkRepo.findByExternalChannel(
				payload.syncConnectionId,
				payload.externalChannelId,
			)

			if (Option.isNone(linkOption)) {
				return yield* Effect.fail(
					new DiscordSyncChannelLinkNotFoundError({
						syncConnectionId: payload.syncConnectionId,
						externalChannelId: payload.externalChannelId,
					}),
				)
			}
			const link = linkOption.value

			const messageLinkOption = yield* messageLinkRepo.findByExternalMessage(
				link.id,
				payload.externalMessageId,
			)

			if (Option.isNone(messageLinkOption)) {
				yield* writeReceipt({
					syncConnectionId: payload.syncConnectionId,
					channelLinkId: link.id,
					source: "external",
					dedupeKey,
					status: "ignored",
					payload,
				})
				return { status: "ignored_missing_link" as const }
			}
			const messageLink = messageLinkOption.value

			const userId = yield* resolveAuthorUserId({
				provider: connection.provider,
				organizationId: connection.organizationId,
				externalUserId: payload.externalUserId,
				displayName: payload.externalAuthorDisplayName ?? "Discord User",
				avatarUrl: payload.externalAuthorAvatarUrl ?? null,
			})

			const existingReaction = yield* messageReactionRepo.findByMessageUserEmoji(
				messageLink.hazelMessageId,
				userId,
				payload.emoji,
			)

			if (Option.isSome(existingReaction)) {
				yield* writeReceipt({
					syncConnectionId: payload.syncConnectionId,
					channelLinkId: link.id,
					source: "external",
					dedupeKey,
					status: "ignored",
					payload,
				})
				return { status: "already_exists" as const }
			}

			const reaction = yield* db.transaction(
				Effect.gen(function* () {
					const [createdReaction] = yield* messageReactionRepo.insert({
						messageId: messageLink.hazelMessageId,
						channelId: link.hazelChannelId,
						userId,
						emoji: payload.emoji,
					})
					yield* outboxRepo.insert({
						eventType: "reaction_created",
						aggregateId: createdReaction.id,
						channelId: createdReaction.channelId,
						payload: {
							reactionId: createdReaction.id,
						},
					})
					return createdReaction
				}),
			)

			yield* writeReceipt({
				syncConnectionId: payload.syncConnectionId,
				channelLinkId: link.id,
				source: "external",
				dedupeKey,
				payload,
			})
			yield* connectionRepo.updateLastSyncedAt(payload.syncConnectionId)
			yield* channelLinkRepo.updateLastSyncedAt(link.id)

			return { status: "created" as const, hazelReactionId: reaction.id }
		})

		const ingestReactionRemove = Effect.fn("discordSyncWorker.ingestReactionRemove")(function* (
			payload: ChatSyncIngressReactionRemove,
		) {
			const dedupeKey =
				payload.dedupeKey ??
				`external:reaction:remove:${payload.externalMessageId}:${payload.externalUserId}:${payload.emoji}`
			const claimed = yield* claimReceipt({
				syncConnectionId: payload.syncConnectionId,
				source: "external",
				dedupeKey,
			})
			if (!claimed) {
				return { status: "deduped" as const }
			}

			const connectionOption = yield* connectionRepo.findById(payload.syncConnectionId)

			if (Option.isNone(connectionOption)) {
				return yield* Effect.fail(
					new DiscordSyncConnectionNotFoundError({
						syncConnectionId: payload.syncConnectionId,
					}),
				)
			}
			const connection = connectionOption.value
			if (connection.status !== "active") {
				yield* writeReceipt({
					syncConnectionId: payload.syncConnectionId,
					source: "external",
					dedupeKey,
					status: "ignored",
					payload,
				})
				return { status: "ignored_connection_inactive" as const }
			}
			yield* getProviderAdapter(connection.provider)

			const linkOption = yield* channelLinkRepo.findByExternalChannel(
				payload.syncConnectionId,
				payload.externalChannelId,
			)

			if (Option.isNone(linkOption)) {
				return yield* Effect.fail(
					new DiscordSyncChannelLinkNotFoundError({
						syncConnectionId: payload.syncConnectionId,
						externalChannelId: payload.externalChannelId,
					}),
				)
			}
			const link = linkOption.value

			const messageLinkOption = yield* messageLinkRepo.findByExternalMessage(
				link.id,
				payload.externalMessageId,
			)

			if (Option.isNone(messageLinkOption)) {
				yield* writeReceipt({
					syncConnectionId: payload.syncConnectionId,
					channelLinkId: link.id,
					source: "external",
					dedupeKey,
					status: "ignored",
					payload,
				})
				return { status: "ignored_missing_link" as const }
			}
			const messageLink = messageLinkOption.value

			const userId = yield* resolveAuthorUserId({
				provider: connection.provider,
				organizationId: connection.organizationId,
				externalUserId: payload.externalUserId,
				displayName: payload.externalAuthorDisplayName ?? "Discord User",
				avatarUrl: payload.externalAuthorAvatarUrl ?? null,
			})

			const existingReaction = yield* messageReactionRepo.findByMessageUserEmoji(
				messageLink.hazelMessageId,
				userId,
				payload.emoji,
			)

			if (Option.isNone(existingReaction)) {
				yield* writeReceipt({
					syncConnectionId: payload.syncConnectionId,
					channelLinkId: link.id,
					source: "external",
					dedupeKey,
					status: "ignored",
					payload,
				})
				return { status: "already_deleted" as const }
			}

			yield* db.transaction(
				Effect.gen(function* () {
					yield* messageReactionRepo.deleteById(existingReaction.value.id)
					yield* outboxRepo.insert({
						eventType: "reaction_deleted",
						aggregateId: existingReaction.value.id,
						channelId: link.hazelChannelId,
						payload: {
							hazelChannelId: link.hazelChannelId,
							hazelMessageId: messageLink.hazelMessageId,
							emoji: payload.emoji,
							userId,
						},
					})
				}),
			)

			yield* writeReceipt({
				syncConnectionId: payload.syncConnectionId,
				channelLinkId: link.id,
				source: "external",
				dedupeKey,
				payload,
			})
			yield* connectionRepo.updateLastSyncedAt(payload.syncConnectionId)
			yield* channelLinkRepo.updateLastSyncedAt(link.id)

			return { status: "deleted" as const, hazelReactionId: existingReaction.value.id }
		})

		const ingestThreadCreate = Effect.fn("discordSyncWorker.ingestThreadCreate")(function* (
			payload: ChatSyncIngressThreadCreate,
		) {
			const dedupeKey = payload.dedupeKey ?? `external:thread:create:${payload.externalThreadId}`
			const claimed = yield* claimReceipt({
				syncConnectionId: payload.syncConnectionId,
				source: "external",
				dedupeKey,
			})
			if (!claimed) {
				return { status: "deduped" as const }
			}

			const connectionOption = yield* connectionRepo.findById(payload.syncConnectionId)

			if (Option.isNone(connectionOption)) {
				return yield* Effect.fail(
					new DiscordSyncConnectionNotFoundError({
						syncConnectionId: payload.syncConnectionId,
					}),
				)
			}
			const connection = connectionOption.value
			if (connection.status !== "active") {
				yield* writeReceipt({
					syncConnectionId: payload.syncConnectionId,
					source: "external",
					dedupeKey,
					status: "ignored",
					payload,
				})
				return { status: "ignored_connection_inactive" as const }
			}
			yield* getProviderAdapter(connection.provider)

			const parentLinkOption = yield* channelLinkRepo.findByExternalChannel(
				payload.syncConnectionId,
				payload.externalParentChannelId,
			)

			if (Option.isNone(parentLinkOption)) {
				return yield* Effect.fail(
					new DiscordSyncChannelLinkNotFoundError({
						syncConnectionId: payload.syncConnectionId,
						externalChannelId: payload.externalParentChannelId,
					}),
				)
			}
			const parentLink = parentLinkOption.value
			const externalThreadChannelId = payload.externalThreadId as unknown as ExternalChannelId

			const existingThreadLink = yield* channelLinkRepo.findByExternalChannel(
				payload.syncConnectionId,
				externalThreadChannelId,
			)

			if (Option.isSome(existingThreadLink)) {
				yield* writeReceipt({
					syncConnectionId: payload.syncConnectionId,
					channelLinkId: existingThreadLink.value.id,
					source: "external",
					dedupeKey,
					status: "ignored",
					payload,
				})
				return { status: "already_linked" as const }
			}

			const [threadChannel] = yield* channelRepo.insert({
				name: payload.name?.trim() || "Thread",
				icon: null,
				type: "thread",
				organizationId: connection.organizationId,
				parentChannelId: parentLink.hazelChannelId,
				sectionId: null,
				deletedAt: null,
			})

			yield* channelAccessSyncService.syncChannel(threadChannel.id)

			const [threadLink] = yield* channelLinkRepo.insert({
				syncConnectionId: payload.syncConnectionId,
				hazelChannelId: threadChannel.id,
				externalChannelId: externalThreadChannelId,
				externalChannelName: payload.name ?? null,
				direction: parentLink.direction,
				isActive: true,
				settings: parentLink.settings,
				lastSyncedAt: null,
				deletedAt: null,
			})

			if (payload.externalRootMessageId) {
				const rootMessageLink = yield* messageLinkRepo.findByExternalMessage(
					parentLink.id,
					payload.externalRootMessageId,
				)

				if (Option.isSome(rootMessageLink)) {
					yield* db.transaction(
						Effect.gen(function* () {
							const updatedMessage = yield* messageRepo.update({
								id: rootMessageLink.value.hazelMessageId,
								threadChannelId: threadChannel.id,
								updatedAt: new Date(),
							})
							yield* outboxRepo.insert({
								eventType: "message_updated",
								aggregateId: updatedMessage.id,
								channelId: updatedMessage.channelId,
								payload: {
									messageId: updatedMessage.id,
								},
							})
						}),
					)
				}
			}

			yield* writeReceipt({
				syncConnectionId: payload.syncConnectionId,
				channelLinkId: threadLink.id,
				source: "external",
				dedupeKey,
				payload,
			})
			yield* connectionRepo.updateLastSyncedAt(payload.syncConnectionId)
			yield* channelLinkRepo.updateLastSyncedAt(threadLink.id)
			yield* channelLinkRepo.updateLastSyncedAt(parentLink.id)

			return {
				status: "created" as const,
				hazelThreadChannelId: threadChannel.id,
				channelLinkId: threadLink.id,
			}
		})

		return {
			syncConnection,
			syncAllActiveConnections,
			syncHazelMessageToProvider,
			syncHazelMessageUpdateToProvider,
			syncHazelMessageDeleteToProvider,
			syncHazelReactionCreateToProvider,
			syncHazelReactionDeleteToProvider,
			syncHazelMessageCreateToAllConnections,
			syncHazelMessageUpdateToAllConnections,
			syncHazelMessageDeleteToAllConnections,
			syncHazelReactionCreateToAllConnections,
			syncHazelReactionDeleteToAllConnections,
			ingestMessageCreate,
			ingestMessageUpdate,
			ingestMessageDelete,
			ingestReactionAdd,
			ingestReactionRemove,
			ingestThreadCreate,
		}
	},
)

export const ChatSyncCoreWorkerLayer = Layer.effect(ChatSyncCoreWorker, ChatSyncCoreWorkerMake).pipe(
	Layer.provide(ChatSyncConnectionRepo.layer),
	Layer.provide(ChatSyncChannelLinkRepo.layer),
	Layer.provide(ChatSyncMessageLinkRepo.layer),
	Layer.provide(ChatSyncEventReceiptRepo.layer),
	Layer.provide(MessageRepo.layer),
	Layer.provide(MessageOutboxRepo.layer),
	Layer.provide(MessageReactionRepo.layer),
	Layer.provide(ChannelRepo.layer),
	Layer.provide(IntegrationConnectionRepo.layer),
	Layer.provide(UserRepo.layer),
	Layer.provide(OrganizationMemberRepo.layer),
	Layer.provide(IntegrationBotService.layer),
	Layer.provide(ChannelAccessSyncService.layer),
	Layer.provide(ChatSyncProviderRegistry.layer),
	Layer.provide(Discord.DiscordApiClient.layer),
)
