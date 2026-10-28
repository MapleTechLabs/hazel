import { describe, expect, it } from "@effect/vitest"
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
import { Database } from "@hazel/db"
import type {
	ChannelId,
	ExternalChannelId,
	ExternalMessageId,
	ExternalThreadId,
	ExternalUserId,
	ExternalWebhookId,
	MessageId,
	OrganizationId,
	SyncChannelLinkId,
	SyncConnectionId,
	UserId,
} from "@hazel/schema"
import { Discord } from "@hazel/integrations"
import { Effect, Layer, Option, Context } from "effect"
import { ChannelAccessSyncService } from "../channel-access-sync.ts"
import { IntegrationBotService } from "../integrations/integration-bot-service.ts"
import { configLayer, serviceShape } from "../../test/effect-helpers.ts"
import { ChatSyncCoreWorker, ChatSyncCoreWorkerMake } from "./chat-sync-core-worker.ts"
import { ChatSyncProviderRegistry } from "./chat-sync-provider-registry.ts"
import {
	DiscordSyncWorker as DiscordSyncWorkerTag,
	type DiscordIngressMessageCreate,
	type DiscordIngressMessageUpdate,
	type DiscordIngressMessageDelete,
	type DiscordIngressReactionAdd,
	type DiscordIngressReactionRemove,
} from "./discord-sync-worker.ts"

const SYNC_CONNECTION_ID = "00000000-0000-4000-8000-000000000001" as SyncConnectionId
const CHANNEL_LINK_ID = "00000000-0000-4000-8000-000000000002" as SyncChannelLinkId
const HAZEL_CHANNEL_ID = "00000000-0000-4000-8000-000000000003" as ChannelId
const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000004" as OrganizationId
const HAZEL_MESSAGE_ID = "00000000-0000-4000-8000-000000000005" as MessageId
const BOT_USER_ID = "00000000-0000-4000-8000-000000000006" as UserId
const REACTION_USER_ID = "00000000-0000-4000-8000-000000000007" as UserId
const DISCORD_CHANNEL_ID = "discord-channel-1" as ExternalChannelId
const DISCORD_CHANNEL_ID_SNOWFLAKE = "123456789012345678" as ExternalChannelId
const DISCORD_MESSAGE_ID = "discord-message-1" as ExternalMessageId
const DISCORD_WEBHOOK_ID = "123456789012345678" as ExternalWebhookId
const DISCORD_WEBHOOK_TOKEN = "webhook-test-token"
const DISCORD_WEBHOOK_MESSAGE_ID = "987654321098765432" as ExternalMessageId
const ATTACHMENT_PUBLIC_URL = "https://cdn.example.com"
const DISCORD_USER_ID_1 = "discord-user-1" as ExternalUserId
const DISCORD_USER_ID_2 = "discord-user-2" as ExternalUserId
const DISCORD_USER_ID_3 = "discord-user-3" as ExternalUserId
const SYNCED_MENTION_USER_ID = "00000000-0000-4000-8000-000000000011" as UserId
const UNSYNCED_MENTION_USER_ID = "00000000-0000-4000-8000-000000000012" as UserId
const INACTIVE_MENTION_USER_ID = "00000000-0000-4000-8000-000000000013" as UserId
const MISSING_EXTERNAL_MENTION_USER_ID = "00000000-0000-4000-8000-000000000014" as UserId
const UNKNOWN_MENTION_USER_ID = "00000000-0000-4000-8000-000000000015" as UserId
const DISCORD_WEBHOOK_EMPTY_SETTINGS = {
	outboundIdentity: {
		enabled: true,
		strategy: "webhook",
		providers: {},
	},
} as const

const DISCORD_FALLBACK_BOT_SETTINGS = {
	outboundIdentity: {
		enabled: true,
		strategy: "fallback_bot",
		providers: {},
	},
} as const

const DISCORD_WEBHOOK_IDENTITY_SETTINGS = {
	outboundIdentity: {
		enabled: true,
		strategy: "webhook",
		providers: {
			discord: {
				kind: "discord.webhook",
				webhookId: DISCORD_WEBHOOK_ID,
				webhookToken: DISCORD_WEBHOOK_TOKEN,
			},
		},
	},
} as const

const DISCORD_WEBHOOK_DENIED_PERMISSION_SETTINGS = {
	outboundIdentity: {
		enabled: true,
		strategy: "webhook",
		providers: {},
	},
	webhookPermission: {
		status: "denied",
		checkedAt: "2026-02-01T00:00:00.000Z",
		reason: "user revoked webhook permissions",
	},
} as const

type WorkerLayerDeps = {
	connectionRepo: unknown
	channelLinkRepo: unknown
	messageLinkRepo: unknown
	eventReceiptRepo: unknown
	messageRepo: unknown
	messageOutboxRepo?: unknown
	messageReactionRepo: unknown
	channelRepo: unknown
	integrationConnectionRepo: unknown
	userRepo: unknown
	organizationMemberRepo: unknown
	integrationBotService: unknown
	channelAccessSyncService: unknown
	providerRegistry?: unknown
	discordApiClient?: unknown
	databaseRun?: (query: unknown) => Effect.Effect<unknown, unknown, never>
}

/** The rows of a `SQLite.insertInto(...).values(rows)` the worker handed to `db.run`, if it was an insert. */
const insertedRows = (query: unknown): Array<any> | undefined =>
	typeof query === "object" &&
	query !== null &&
	"_tag" in query &&
	query._tag === "CHInsert" &&
	"_state" in query
		? [...((query as { _state: { rows?: ReadonlyArray<unknown> } })._state.rows ?? [])]
		: undefined

type DiscordSyncWorkerShape = Context.Service.Shape<typeof DiscordSyncWorkerTag>

const PAYLOAD: DiscordIngressMessageCreate = {
	syncConnectionId: SYNC_CONNECTION_ID,
	externalChannelId: DISCORD_CHANNEL_ID,
	externalMessageId: DISCORD_MESSAGE_ID,
	content: "hello",
}

const runWorkerEffect = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	Effect.runPromise(Effect.scoped(effect as Effect.Effect<A, E, never>))

const defaultProviderRegistry = serviceShape<typeof ChatSyncProviderRegistry>({
	getAdapter: () =>
		Effect.succeed({
			provider: "discord",
			createMessage: () => Effect.succeed(DISCORD_MESSAGE_ID),
			createMessageWithAttachments: () => Effect.succeed(DISCORD_MESSAGE_ID),
			updateMessage: () => Effect.succeed(undefined),
			deleteMessage: () => Effect.succeed(undefined),
			addReaction: () => Effect.succeed(undefined),
			removeReaction: () => Effect.succeed(undefined),
			createThread: () => Effect.succeed("123456789012345679" as ExternalThreadId),
		}),
})

const defaultDiscordApiClient = serviceShape<typeof Discord.DiscordApiClient>({
	getAccountInfo: () => Effect.succeed({ id: "discord-bot" }),
	listGuilds: () => Effect.succeed([]),
	listGuildChannels: () => Effect.succeed([]),
	createMessage: () => Effect.succeed(DISCORD_MESSAGE_ID),
	updateMessage: () => Effect.succeed(undefined),
	deleteMessage: () => Effect.succeed(undefined),
	createWebhook: () =>
		Effect.succeed({
			id: DISCORD_WEBHOOK_ID,
			token: DISCORD_WEBHOOK_TOKEN,
		}),
	executeWebhookMessage: () => Effect.succeed(DISCORD_WEBHOOK_MESSAGE_ID),
	updateWebhookMessage: () => Effect.succeed(undefined),
	deleteWebhookMessage: () => Effect.succeed(undefined),
	addReaction: () => Effect.succeed(undefined),
	removeReaction: () => Effect.succeed(undefined),
	createThread: () => Effect.succeed("123456789012345680"),
})

const makeWorkerLayer = (deps: WorkerLayerDeps) =>
	Layer.effect(DiscordSyncWorkerTag, DiscordSyncWorkerTag.make).pipe(
		Layer.provide(
			Layer.effect(ChatSyncCoreWorker, ChatSyncCoreWorkerMake).pipe(
				Layer.provide(
					deps.providerRegistry
						? Layer.succeed(
								ChatSyncProviderRegistry,
								serviceShape<typeof ChatSyncProviderRegistry>(deps.providerRegistry),
							)
						: Layer.succeed(ChatSyncProviderRegistry, defaultProviderRegistry),
				),
				Layer.provide(
					deps.discordApiClient
						? Layer.succeed(
								Discord.DiscordApiClient,
								serviceShape<typeof Discord.DiscordApiClient>(deps.discordApiClient),
							)
						: Layer.succeed(Discord.DiscordApiClient, defaultDiscordApiClient),
				),
			),
		),
		Layer.provide(
			Layer.succeed(Database.Database, {
				run: (query: unknown) => (deps.databaseRun ? deps.databaseRun(query) : Effect.succeed([])),
				first: (query: unknown) =>
					(deps.databaseRun ? deps.databaseRun(query) : Effect.succeed([])).pipe(
						Effect.map((rows) => Option.fromNullishOr((rows as ReadonlyArray<unknown>)[0])),
					),
				query: () => Effect.die("not used in this test"),
				execute: () => Effect.die("not used in this test"),
				transaction: (effect: Effect.Effect<unknown, unknown, unknown>) => effect,
			} as unknown as Database.DatabaseShape),
		),
		Layer.provide(
			Layer.succeed(
				ChatSyncConnectionRepo,
				serviceShape<typeof ChatSyncConnectionRepo>(deps.connectionRepo),
			),
		),
		Layer.provide(
			Layer.succeed(
				ChatSyncChannelLinkRepo,
				serviceShape<typeof ChatSyncChannelLinkRepo>(deps.channelLinkRepo),
			),
		),
		Layer.provide(
			Layer.succeed(
				ChatSyncMessageLinkRepo,
				serviceShape<typeof ChatSyncMessageLinkRepo>(deps.messageLinkRepo),
			),
		),
		Layer.provide(
			Layer.succeed(
				ChatSyncEventReceiptRepo,
				serviceShape<typeof ChatSyncEventReceiptRepo>(deps.eventReceiptRepo),
			),
		),
		Layer.provide(Layer.succeed(MessageRepo, serviceShape<typeof MessageRepo>(deps.messageRepo))),
		Layer.provide(
			Layer.succeed(
				MessageOutboxRepo,
				serviceShape<typeof MessageOutboxRepo>(
					deps.messageOutboxRepo ?? {
						insert: () => Effect.succeed([{ id: "outbox-id" }]),
					},
				),
			),
		),
		Layer.provide(
			Layer.succeed(
				MessageReactionRepo,
				serviceShape<typeof MessageReactionRepo>(deps.messageReactionRepo),
			),
		),
		Layer.provide(Layer.succeed(ChannelRepo, serviceShape<typeof ChannelRepo>(deps.channelRepo))),
		Layer.provide(
			Layer.succeed(
				IntegrationConnectionRepo,
				serviceShape<typeof IntegrationConnectionRepo>(deps.integrationConnectionRepo),
			),
		),
		Layer.provide(Layer.succeed(UserRepo, serviceShape<typeof UserRepo>(deps.userRepo))),
		Layer.provide(
			Layer.succeed(
				OrganizationMemberRepo,
				serviceShape<typeof OrganizationMemberRepo>(deps.organizationMemberRepo),
			),
		),
		Layer.provide(
			Layer.succeed(
				IntegrationBotService,
				serviceShape<typeof IntegrationBotService>(deps.integrationBotService),
			),
		),
		Layer.provide(
			Layer.succeed(
				ChannelAccessSyncService,
				serviceShape<typeof ChannelAccessSyncService>(deps.channelAccessSyncService),
			),
		),
	)

const makeWorkerLayerWithOverrides = (deps: WorkerLayerDeps) => {
	let layer = makeWorkerLayer(deps)
	return layer
}

const useWorker = <A, E, R>(fn: (worker: DiscordSyncWorkerShape) => Effect.Effect<A, E, R>) =>
	DiscordSyncWorkerTag.use(fn)

const DiscordSyncWorker = {
	ingestMessageCreate: (payload: DiscordIngressMessageCreate) =>
		useWorker((worker) => worker.ingestMessageCreate(payload)),
	ingestMessageUpdate: (payload: DiscordIngressMessageUpdate) =>
		useWorker((worker) => worker.ingestMessageUpdate(payload)),
	ingestMessageDelete: (payload: DiscordIngressMessageDelete) =>
		useWorker((worker) => worker.ingestMessageDelete(payload)),
	ingestReactionAdd: (payload: DiscordIngressReactionAdd) =>
		useWorker((worker) => worker.ingestReactionAdd(payload)),
	ingestReactionRemove: (payload: DiscordIngressReactionRemove) =>
		useWorker((worker) => worker.ingestReactionRemove(payload)),
	syncHazelMessageToDiscord: (
		syncConnectionId: SyncConnectionId,
		hazelMessageId: MessageId,
		dedupeKeyOverride?: string,
	) =>
		useWorker((worker) =>
			worker.syncHazelMessageToDiscord(syncConnectionId, hazelMessageId, dedupeKeyOverride),
		),
	syncHazelMessageUpdateToDiscord: (
		syncConnectionId: SyncConnectionId,
		hazelMessageId: MessageId,
		dedupeKeyOverride?: string,
	) =>
		useWorker((worker) =>
			worker.syncHazelMessageUpdateToDiscord(syncConnectionId, hazelMessageId, dedupeKeyOverride),
		),
	syncHazelMessageDeleteToDiscord: (
		syncConnectionId: SyncConnectionId,
		hazelMessageId: MessageId,
		dedupeKeyOverride?: string,
	) =>
		useWorker((worker) =>
			worker.syncHazelMessageDeleteToDiscord(syncConnectionId, hazelMessageId, dedupeKeyOverride),
		),
}

describe("DiscordSyncWorker dedupe claim", () => {
	it("returns deduped and exits before side effects when claim fails", async () => {
		let connectionLookupCalled = false
		let channelLookupCalled = false
		let messageLinkLookupCalled = false
		let messageInsertCalled = false
		let botLookupCalled = false

		const layer = makeWorkerLayer({
			connectionRepo: {
				findById: () => {
					connectionLookupCalled = true
					return Effect.succeed(Option.none())
				},
			} as unknown as ChatSyncConnectionRepo,
			channelLinkRepo: {
				findByExternalChannel: () => {
					channelLookupCalled = true
					return Effect.succeed(Option.none())
				},
			} as unknown as ChatSyncChannelLinkRepo,
			messageLinkRepo: {
				findByExternalMessage: () => {
					messageLinkLookupCalled = true
					return Effect.succeed(Option.none())
				},
			} as unknown as ChatSyncMessageLinkRepo,
			eventReceiptRepo: {
				claimByDedupeKey: () => Effect.succeed(false),
				updateByDedupeKey: () => Effect.succeed([]),
			} as unknown as ChatSyncEventReceiptRepo,
			messageRepo: {
				insert: () => {
					messageInsertCalled = true
					return Effect.succeed([])
				},
			} as unknown as MessageRepo,
			messageReactionRepo: {} as unknown as MessageReactionRepo,
			channelRepo: {} as unknown as ChannelRepo,
			integrationConnectionRepo: {} as unknown as IntegrationConnectionRepo,
			userRepo: {} as unknown as UserRepo,
			organizationMemberRepo: {} as unknown as OrganizationMemberRepo,
			integrationBotService: {
				getOrCreateBotUser: () => {
					botLookupCalled = true
					return Effect.succeed({
						id: BOT_USER_ID,
					})
				},
			} as unknown as IntegrationBotService,
			channelAccessSyncService: {} as unknown as ChannelAccessSyncService,
		})

		const result = await runWorkerEffect(
			DiscordSyncWorker.ingestMessageCreate(PAYLOAD).pipe(Effect.provide(layer)),
		)

		expect(result.status).toBe("deduped")
		expect(connectionLookupCalled).toBe(false)
		expect(channelLookupCalled).toBe(false)
		expect(messageLinkLookupCalled).toBe(false)
		expect(messageInsertCalled).toBe(false)
		expect(botLookupCalled).toBe(false)
	})

	it("marks claimed receipt as ignored when message is already linked", async () => {
		let updatedStatus: "processed" | "ignored" | "failed" | undefined
		let updatedChannelLinkId: SyncChannelLinkId | undefined
		let botLookupCalled = false
		let messageInsertCalled = false

		const layer = makeWorkerLayer({
			connectionRepo: {
				findById: () =>
					Effect.succeed(
						Option.some({
							id: SYNC_CONNECTION_ID,
							organizationId: ORGANIZATION_ID,
							provider: "discord",
							status: "active",
						}),
					),
			} as unknown as ChatSyncConnectionRepo,
			channelLinkRepo: {
				findByExternalChannel: () =>
					Effect.succeed(
						Option.some({
							id: CHANNEL_LINK_ID,
							hazelChannelId: HAZEL_CHANNEL_ID,
						}),
					),
			} as unknown as ChatSyncChannelLinkRepo,
			messageLinkRepo: {
				findByExternalMessage: () =>
					Effect.succeed(
						Option.some({
							channelLinkId: CHANNEL_LINK_ID,
							hazelMessageId: HAZEL_MESSAGE_ID,
							externalMessageId: PAYLOAD.externalMessageId,
						}),
					),
			} as unknown as ChatSyncMessageLinkRepo,
			eventReceiptRepo: {
				claimByDedupeKey: () => Effect.succeed(true),
				updateByDedupeKey: (params: any) => {
					updatedStatus = params.status
					updatedChannelLinkId = params.channelLinkId
					return Effect.succeed([])
				},
			} as unknown as ChatSyncEventReceiptRepo,
			messageRepo: {
				insert: () => {
					messageInsertCalled = true
					return Effect.succeed([])
				},
			} as unknown as MessageRepo,
			messageReactionRepo: {} as unknown as MessageReactionRepo,
			channelRepo: {} as unknown as ChannelRepo,
			integrationConnectionRepo: {} as unknown as IntegrationConnectionRepo,
			userRepo: {} as unknown as UserRepo,
			organizationMemberRepo: {} as unknown as OrganizationMemberRepo,
			integrationBotService: {
				getOrCreateBotUser: () => {
					botLookupCalled = true
					return Effect.succeed({
						id: BOT_USER_ID,
					})
				},
			} as unknown as IntegrationBotService,
			channelAccessSyncService: {} as unknown as ChannelAccessSyncService,
		})

		const result = await runWorkerEffect(
			DiscordSyncWorker.ingestMessageCreate(PAYLOAD).pipe(Effect.provide(layer)),
		)

		expect(result.status).toBe("already_linked")
		expect(updatedStatus).toBe("ignored")
		expect(updatedChannelLinkId).toBe(CHANNEL_LINK_ID)
		expect(botLookupCalled).toBe(false)
		expect(messageInsertCalled).toBe(false)
	})
})

describe("DiscordSyncWorker inbound attachment records", () => {
	it("creates Hazel attachment rows with external URLs on message create", async () => {
		let insertedContent: string | null = null
		let insertedAttachmentRows: Array<any> = []

		const layer = makeWorkerLayer({
			connectionRepo: {
				findById: () =>
					Effect.succeed(
						Option.some({
							id: SYNC_CONNECTION_ID,
							organizationId: ORGANIZATION_ID,
							provider: "discord",
							status: "active",
						}),
					),
				updateLastSyncedAt: () => Effect.succeed([]),
			} as unknown as ChatSyncConnectionRepo,
			channelLinkRepo: {
				findByExternalChannel: () =>
					Effect.succeed(
						Option.some({
							id: CHANNEL_LINK_ID,
							hazelChannelId: HAZEL_CHANNEL_ID,
							settings: null,
						}),
					),
				updateLastSyncedAt: () => Effect.succeed([]),
			} as unknown as ChatSyncChannelLinkRepo,
			messageLinkRepo: {
				findByExternalMessage: () => Effect.succeed(Option.none()),
				insert: () => Effect.succeed([{ id: "message-link-id" }]),
			} as unknown as ChatSyncMessageLinkRepo,
			eventReceiptRepo: {
				claimByDedupeKey: () => Effect.succeed(true),
				updateByDedupeKey: () => Effect.succeed([]),
			} as unknown as ChatSyncEventReceiptRepo,
			messageRepo: {
				insert: (payload: { content: string }) => {
					insertedContent = payload.content
					return Effect.succeed([{ id: HAZEL_MESSAGE_ID, threadChannelId: null }])
				},
			} as unknown as MessageRepo,
			messageReactionRepo: {} as unknown as MessageReactionRepo,
			channelRepo: {} as unknown as ChannelRepo,
			integrationConnectionRepo: {} as unknown as IntegrationConnectionRepo,
			userRepo: {} as unknown as UserRepo,
			organizationMemberRepo: {} as unknown as OrganizationMemberRepo,
			integrationBotService: {
				getOrCreateBotUser: () => Effect.succeed({ id: BOT_USER_ID }),
			} as unknown as IntegrationBotService,
			channelAccessSyncService: {} as unknown as ChannelAccessSyncService,
			providerRegistry: {
				getAdapter: () =>
					Effect.succeed({
						provider: "discord",
						createMessage: () => Effect.succeed(DISCORD_MESSAGE_ID),
						createMessageWithAttachments: () => Effect.succeed(DISCORD_MESSAGE_ID),
						updateMessage: () => Effect.succeed(undefined),
						deleteMessage: () => Effect.succeed(undefined),
						addReaction: () => Effect.succeed(undefined),
						removeReaction: () => Effect.succeed(undefined),
						createThread: () => Effect.succeed("thread-id"),
					}),
			} as unknown as ChatSyncProviderRegistry,
			databaseRun: (query) =>
				Effect.sync(() => {
					const rows = insertedRows(query)
					if (rows) {
						insertedAttachmentRows = rows
					}
					return []
				}),
		})

		const result = await runWorkerEffect(
			DiscordSyncWorker.ingestMessageCreate({
				...PAYLOAD,
				content: "discord text",
				externalAttachments: [
					{
						externalAttachmentId: "att-1",
						fileName: "diagram.png",
						fileSize: 2048,
						publicUrl: "https://cdn.discordapp.com/diagram.png",
					},
				],
			}).pipe(Effect.provide(layer)),
		)

		expect(result.status).toBe("created")
		expect(insertedContent).toBe("discord text")
		expect(insertedAttachmentRows.length).toBe(1)
		expect(insertedAttachmentRows[0]?.fileName).toBe("diagram.png")
		expect(insertedAttachmentRows[0]?.externalUrl).toBe("https://cdn.discordapp.com/diagram.png")
		expect(insertedAttachmentRows[0]?.status).toBe("complete")
	})

	it("keeps plain content unchanged and does not write attachment rows when there are no attachments", async () => {
		let insertedContent: string | null = null
		let databaseRunCalls = 0

		const layer = makeWorkerLayer({
			connectionRepo: {
				findById: () =>
					Effect.succeed(
						Option.some({
							id: SYNC_CONNECTION_ID,
							organizationId: ORGANIZATION_ID,
							provider: "discord",
							status: "active",
						}),
					),
				updateLastSyncedAt: () => Effect.succeed([]),
			} as unknown as ChatSyncConnectionRepo,
			channelLinkRepo: {
				findByExternalChannel: () =>
					Effect.succeed(
						Option.some({
							id: CHANNEL_LINK_ID,
							hazelChannelId: HAZEL_CHANNEL_ID,
							settings: null,
						}),
					),
				updateLastSyncedAt: () => Effect.succeed([]),
			} as unknown as ChatSyncChannelLinkRepo,
			messageLinkRepo: {
				findByExternalMessage: () => Effect.succeed(Option.none()),
				insert: () => Effect.succeed([{ id: "message-link-id" }]),
			} as unknown as ChatSyncMessageLinkRepo,
			eventReceiptRepo: {
				claimByDedupeKey: () => Effect.succeed(true),
				updateByDedupeKey: () => Effect.succeed([]),
			} as unknown as ChatSyncEventReceiptRepo,
			messageRepo: {
				insert: (payload: { content: string }) => {
					insertedContent = payload.content
					return Effect.succeed([{ id: HAZEL_MESSAGE_ID, threadChannelId: null }])
				},
			} as unknown as MessageRepo,
			messageReactionRepo: {} as unknown as MessageReactionRepo,
			channelRepo: {} as unknown as ChannelRepo,
			integrationConnectionRepo: {} as unknown as IntegrationConnectionRepo,
			userRepo: {} as unknown as UserRepo,
			organizationMemberRepo: {} as unknown as OrganizationMemberRepo,
			integrationBotService: {
				getOrCreateBotUser: () => Effect.succeed({ id: BOT_USER_ID }),
			} as unknown as IntegrationBotService,
			channelAccessSyncService: {} as unknown as ChannelAccessSyncService,
			providerRegistry: {
				getAdapter: () =>
					Effect.succeed({
						provider: "discord",
						createMessage: () => Effect.succeed(DISCORD_MESSAGE_ID),
						createMessageWithAttachments: () => Effect.succeed(DISCORD_MESSAGE_ID),
						updateMessage: () => Effect.succeed(undefined),
						deleteMessage: () => Effect.succeed(undefined),
						addReaction: () => Effect.succeed(undefined),
						removeReaction: () => Effect.succeed(undefined),
						createThread: () => Effect.succeed("thread-id"),
					}),
			} as unknown as ChatSyncProviderRegistry,
			databaseRun: () =>
				Effect.sync(() => {
					databaseRunCalls += 1
					return []
				}),
		})

		const result = await runWorkerEffect(
			DiscordSyncWorker.ingestMessageCreate({
				...PAYLOAD,
				content: "plain text from discord",
			}).pipe(Effect.provide(layer)),
		)

		expect(result.status).toBe("created")
		expect(insertedContent).toBe("plain text from discord")
		expect(databaseRunCalls).toBe(0)
	})

	it("writes only valid attachment rows when payload includes malformed attachment items", async () => {
		let insertedContent: string | null = null
		let insertedAttachmentRows: Array<any> = []

		const layer = makeWorkerLayer({
			connectionRepo: {
				findById: () =>
					Effect.succeed(
						Option.some({
							id: SYNC_CONNECTION_ID,
							organizationId: ORGANIZATION_ID,
							provider: "discord",
							status: "active",
						}),
					),
				updateLastSyncedAt: () => Effect.succeed([]),
			} as unknown as ChatSyncConnectionRepo,
			channelLinkRepo: {
				findByExternalChannel: () =>
					Effect.succeed(
						Option.some({
							id: CHANNEL_LINK_ID,
							hazelChannelId: HAZEL_CHANNEL_ID,
							settings: null,
						}),
					),
				updateLastSyncedAt: () => Effect.succeed([]),
			} as unknown as ChatSyncChannelLinkRepo,
			messageLinkRepo: {
				findByExternalMessage: () => Effect.succeed(Option.none()),
				insert: () => Effect.succeed([{ id: "message-link-id" }]),
			} as unknown as ChatSyncMessageLinkRepo,
			eventReceiptRepo: {
				claimByDedupeKey: () => Effect.succeed(true),
				updateByDedupeKey: () => Effect.succeed([]),
			} as unknown as ChatSyncEventReceiptRepo,
			messageRepo: {
				insert: (payload: { content: string }) => {
					insertedContent = payload.content
					return Effect.succeed([{ id: HAZEL_MESSAGE_ID, threadChannelId: null }])
				},
			} as unknown as MessageRepo,
			messageReactionRepo: {} as unknown as MessageReactionRepo,
			channelRepo: {} as unknown as ChannelRepo,
			integrationConnectionRepo: {} as unknown as IntegrationConnectionRepo,
			userRepo: {} as unknown as UserRepo,
			organizationMemberRepo: {} as unknown as OrganizationMemberRepo,
			integrationBotService: {
				getOrCreateBotUser: () => Effect.succeed({ id: BOT_USER_ID }),
			} as unknown as IntegrationBotService,
			channelAccessSyncService: {} as unknown as ChannelAccessSyncService,
			providerRegistry: {
				getAdapter: () =>
					Effect.succeed({
						provider: "discord",
						createMessage: () => Effect.succeed(DISCORD_MESSAGE_ID),
						createMessageWithAttachments: () => Effect.succeed(DISCORD_MESSAGE_ID),
						updateMessage: () => Effect.succeed(undefined),
						deleteMessage: () => Effect.succeed(undefined),
						addReaction: () => Effect.succeed(undefined),
						removeReaction: () => Effect.succeed(undefined),
						createThread: () => Effect.succeed("thread-id"),
					}),
			} as unknown as ChatSyncProviderRegistry,
			databaseRun: (query) =>
				Effect.sync(() => {
					const rows = insertedRows(query)
					if (rows) {
						insertedAttachmentRows = rows
					}
					return []
				}),
		})

		const result = await runWorkerEffect(
			DiscordSyncWorker.ingestMessageCreate({
				...PAYLOAD,
				content: "",
				externalAttachments: [
					{
						externalAttachmentId: "skip-empty-name",
						fileName: " ",
						fileSize: 100,
						publicUrl: "https://cdn.discordapp.com/skip-name",
					},
					{
						externalAttachmentId: "keep-video",
						fileName: "video.mov",
						fileSize: -42,
						publicUrl: "https://cdn.discordapp.com/video.mov",
					},
					{
						externalAttachmentId: "skip-empty-url",
						fileName: "skip-url.txt",
						fileSize: 10,
						publicUrl: " ",
					},
					{
						externalAttachmentId: "keep-log",
						fileName: "  trace.log  ",
						fileSize: 9,
						publicUrl: "  https://cdn.discordapp.com/trace.log  ",
					},
				],
			}).pipe(Effect.provide(layer)),
		)

		expect(result.status).toBe("created")
		expect(insertedContent).toBe("")
		expect(insertedAttachmentRows.length).toBe(2)
		expect(insertedAttachmentRows[0]?.fileName).toBe("video.mov")
		expect(insertedAttachmentRows[0]?.fileSize).toBe(0)
		expect(insertedAttachmentRows[1]?.fileName).toBe("trace.log")
		expect(insertedAttachmentRows[1]?.externalUrl).toBe("https://cdn.discordapp.com/trace.log")
	})

	it("keeps update ingestion content-only with no attachment reconciliation", async () => {
		let updatedContent: string | null = null

		const layer = makeWorkerLayer({
			connectionRepo: {
				findById: () =>
					Effect.succeed(
						Option.some({
							id: SYNC_CONNECTION_ID,
							organizationId: ORGANIZATION_ID,
							provider: "discord",
							status: "active",
						}),
					),
				updateLastSyncedAt: () => Effect.succeed([]),
			} as unknown as ChatSyncConnectionRepo,
			channelLinkRepo: {
				findByExternalChannel: () =>
					Effect.succeed(
						Option.some({
							id: CHANNEL_LINK_ID,
							hazelChannelId: HAZEL_CHANNEL_ID,
							settings: null,
						}),
					),
				updateLastSyncedAt: () => Effect.succeed([]),
			} as unknown as ChatSyncChannelLinkRepo,
			messageLinkRepo: {
				findByExternalMessage: () =>
					Effect.succeed(
						Option.some({
							channelLinkId: CHANNEL_LINK_ID,
							hazelMessageId: HAZEL_MESSAGE_ID,
							externalMessageId: DISCORD_MESSAGE_ID,
						}),
					),
			} as unknown as ChatSyncMessageLinkRepo,
			eventReceiptRepo: {
				claimByDedupeKey: () => Effect.succeed(true),
				updateByDedupeKey: () => Effect.succeed([]),
			} as unknown as ChatSyncEventReceiptRepo,
			messageRepo: {
				update: (payload: { content?: string }) => {
					updatedContent = payload.content ?? null
					return Effect.succeed([{ id: HAZEL_MESSAGE_ID }])
				},
			} as unknown as MessageRepo,
			messageReactionRepo: {} as unknown as MessageReactionRepo,
			channelRepo: {} as unknown as ChannelRepo,
			integrationConnectionRepo: {} as unknown as IntegrationConnectionRepo,
			userRepo: {} as unknown as UserRepo,
			organizationMemberRepo: {} as unknown as OrganizationMemberRepo,
			integrationBotService: {
				getOrCreateBotUser: () => Effect.succeed({ id: BOT_USER_ID }),
			} as unknown as IntegrationBotService,
			channelAccessSyncService: {} as unknown as ChannelAccessSyncService,
			providerRegistry: {
				getAdapter: () =>
					Effect.succeed({
						provider: "discord",
						createMessage: () => Effect.succeed(DISCORD_MESSAGE_ID),
						createMessageWithAttachments: () => Effect.succeed(DISCORD_MESSAGE_ID),
						updateMessage: () => Effect.succeed(undefined),
						deleteMessage: () => Effect.succeed(undefined),
						addReaction: () => Effect.succeed(undefined),
						removeReaction: () => Effect.succeed(undefined),
						createThread: () => Effect.succeed("thread-id"),
					}),
			} as unknown as ChatSyncProviderRegistry,
		})

		const content = "edited text only"
		const result = await runWorkerEffect(
			DiscordSyncWorker.ingestMessageUpdate({
				syncConnectionId: SYNC_CONNECTION_ID,
				externalChannelId: DISCORD_CHANNEL_ID,
				externalMessageId: DISCORD_MESSAGE_ID,
				content,
			}).pipe(Effect.provide(layer)),
		)

		expect(result.status).toBe("updated")
		expect(updatedContent).toBe(content)
	})
})

describe("DiscordSyncWorker reaction author enrichment", () => {
	it("uses external reaction author metadata when creating shadow reaction users", async () => {
		let upsertPayload: unknown = null
		let upsertOptions: unknown = null

		const payload: DiscordIngressReactionAdd = {
			syncConnectionId: SYNC_CONNECTION_ID,
			externalChannelId: DISCORD_CHANNEL_ID,
			externalMessageId: DISCORD_MESSAGE_ID,
			externalUserId: DISCORD_USER_ID_1,
			emoji: "🚀",
			externalAuthorDisplayName: "Alex Doe",
			externalAuthorAvatarUrl: "https://cdn.discordapp.com/avatars/discord-user-1/abc.png",
		}

		const layer = makeWorkerLayer({
			connectionRepo: {
				findById: () =>
					Effect.succeed(
						Option.some({
							id: SYNC_CONNECTION_ID,
							organizationId: ORGANIZATION_ID,
							provider: "discord",
							status: "active",
						}),
					),
				updateLastSyncedAt: () => Effect.succeed({ id: SYNC_CONNECTION_ID }),
			} as unknown as ChatSyncConnectionRepo,
			channelLinkRepo: {
				findByExternalChannel: () =>
					Effect.succeed(
						Option.some({
							id: CHANNEL_LINK_ID,
							hazelChannelId: HAZEL_CHANNEL_ID,
						}),
					),
				updateLastSyncedAt: () => Effect.succeed({ id: CHANNEL_LINK_ID }),
			} as unknown as ChatSyncChannelLinkRepo,
			messageLinkRepo: {
				findByExternalMessage: () =>
					Effect.succeed(
						Option.some({
							channelLinkId: CHANNEL_LINK_ID,
							hazelMessageId: HAZEL_MESSAGE_ID,
							externalMessageId: DISCORD_MESSAGE_ID,
						}),
					),
			} as unknown as ChatSyncMessageLinkRepo,
			eventReceiptRepo: {
				claimByDedupeKey: () => Effect.succeed(true),
				updateByDedupeKey: () => Effect.succeed([]),
			} as unknown as ChatSyncEventReceiptRepo,
			messageRepo: {
				insert: () => Effect.succeed([]),
			} as unknown as MessageRepo,
			messageReactionRepo: {
				findByMessageUserEmoji: () => Effect.succeed(Option.none()),
				insert: () =>
					Effect.succeed([
						{
							id: REACTION_USER_ID,
							messageId: HAZEL_MESSAGE_ID,
							channelId: HAZEL_CHANNEL_ID,
							userId: "00000000-0000-4000-8000-000000000008",
							emoji: "🚀",
						},
					]),
			} as unknown as MessageReactionRepo,
			channelRepo: {} as unknown as ChannelRepo,
			integrationConnectionRepo: {
				findActiveUserByExternalAccountId: () => Effect.succeed(Option.none()),
			} as unknown as IntegrationConnectionRepo,
			userRepo: {
				upsertByExternalId: (
					data: { externalId: string; firstName: string; avatarUrl?: string | null },
					options: { syncAvatarUrl?: boolean } | undefined,
				) => {
					upsertPayload = {
						externalId: data.externalId,
						firstName: data.firstName,
						avatarUrl: data.avatarUrl ?? "",
					}
					upsertOptions = options ?? null
					return Effect.succeed({
						id: REACTION_USER_ID,
					})
				},
			} as unknown as UserRepo,
			organizationMemberRepo: {
				upsertByOrgAndUser: () => Effect.succeed({ id: REACTION_USER_ID }),
			} as unknown as OrganizationMemberRepo,
			integrationBotService: {
				getOrCreateBotUser: () => Effect.succeed({ id: BOT_USER_ID }),
			} as unknown as IntegrationBotService,
			channelAccessSyncService: {} as unknown as ChannelAccessSyncService,
		})

		const result = await runWorkerEffect(
			DiscordSyncWorker.ingestReactionAdd(payload).pipe(Effect.provide(layer)),
		)

		expect(result.status).toBe("created")
		const createdPayload = upsertPayload as {
			externalId: string
			firstName: string
			avatarUrl: string
		} | null
		const createdOptions = upsertOptions as { syncAvatarUrl?: boolean } | null

		expect(createdPayload?.firstName).toBe("Alex Doe")
		expect(createdPayload?.avatarUrl).toBe("https://cdn.discordapp.com/avatars/discord-user-1/abc.png")
		expect(createdPayload?.externalId).toBe("discord-user-discord-user-1")
		expect(createdOptions?.syncAvatarUrl).toBe(true)
	})

	it("falls back to generic shadow user name when reaction author metadata is unavailable", async () => {
		let upsertPayload: unknown = null
		let upsertOptions: unknown = null

		const payload: DiscordIngressReactionAdd = {
			syncConnectionId: SYNC_CONNECTION_ID,
			externalChannelId: DISCORD_CHANNEL_ID,
			externalMessageId: DISCORD_MESSAGE_ID,
			externalUserId: DISCORD_USER_ID_2,
			emoji: "🚀",
		}

		const layer = makeWorkerLayer({
			connectionRepo: {
				findById: () =>
					Effect.succeed(
						Option.some({
							id: SYNC_CONNECTION_ID,
							organizationId: ORGANIZATION_ID,
							provider: "discord",
							status: "active",
						}),
					),
				updateLastSyncedAt: () => Effect.succeed({ id: SYNC_CONNECTION_ID }),
			} as unknown as ChatSyncConnectionRepo,
			channelLinkRepo: {
				findByExternalChannel: () =>
					Effect.succeed(
						Option.some({
							id: CHANNEL_LINK_ID,
							hazelChannelId: HAZEL_CHANNEL_ID,
						}),
					),
				updateLastSyncedAt: () => Effect.succeed({ id: CHANNEL_LINK_ID }),
			} as unknown as ChatSyncChannelLinkRepo,
			messageLinkRepo: {
				findByExternalMessage: () =>
					Effect.succeed(
						Option.some({
							channelLinkId: CHANNEL_LINK_ID,
							hazelMessageId: HAZEL_MESSAGE_ID,
							externalMessageId: DISCORD_MESSAGE_ID,
						}),
					),
			} as unknown as ChatSyncMessageLinkRepo,
			eventReceiptRepo: {
				claimByDedupeKey: () => Effect.succeed(true),
				updateByDedupeKey: () => Effect.succeed([]),
			} as unknown as ChatSyncEventReceiptRepo,
			messageRepo: {
				insert: () => Effect.succeed([]),
			} as unknown as MessageRepo,
			messageReactionRepo: {
				findByMessageUserEmoji: () => Effect.succeed(Option.none()),
				insert: () =>
					Effect.succeed([
						{
							id: REACTION_USER_ID,
							messageId: HAZEL_MESSAGE_ID,
							channelId: HAZEL_CHANNEL_ID,
							userId: "00000000-0000-4000-8000-000000000008",
							emoji: "🚀",
						},
					]),
			} as unknown as MessageReactionRepo,
			channelRepo: {} as unknown as ChannelRepo,
			integrationConnectionRepo: {
				findActiveUserByExternalAccountId: () => Effect.succeed(Option.none()),
			} as unknown as IntegrationConnectionRepo,
			userRepo: {
				upsertByExternalId: (
					data: { firstName: string; avatarUrl?: string | null },
					options: { syncAvatarUrl?: boolean } | undefined,
				) => {
					upsertPayload = {
						firstName: data.firstName,
						avatarUrl: data.avatarUrl ?? "",
					}
					upsertOptions = options ?? null
					return Effect.succeed({
						id: REACTION_USER_ID,
					})
				},
			} as unknown as UserRepo,
			organizationMemberRepo: {
				upsertByOrgAndUser: () => Effect.succeed({ id: REACTION_USER_ID }),
			} as unknown as OrganizationMemberRepo,
			integrationBotService: {
				getOrCreateBotUser: () => Effect.succeed({ id: BOT_USER_ID }),
			} as unknown as IntegrationBotService,
			channelAccessSyncService: {} as unknown as ChannelAccessSyncService,
		})

		const result = await runWorkerEffect(
			DiscordSyncWorker.ingestReactionAdd(payload).pipe(Effect.provide(layer)),
		)

		expect(result.status).toBe("created")
		const fallbackPayload = upsertPayload as { firstName: string; avatarUrl: string } | null
		const fallbackOptions = upsertOptions as { syncAvatarUrl?: boolean } | null

		expect(fallbackPayload?.firstName).toBe("Discord User")
		expect(fallbackPayload?.avatarUrl).toBe("")
		expect(fallbackOptions?.syncAvatarUrl).toBe(false)
	})

	it("uses external reaction author metadata on reaction removal as well", async () => {
		let upsertPayload: unknown = null
		let upsertOptions: unknown = null

		const payload: DiscordIngressReactionRemove = {
			syncConnectionId: SYNC_CONNECTION_ID,
			externalChannelId: DISCORD_CHANNEL_ID,
			externalMessageId: DISCORD_MESSAGE_ID,
			externalUserId: DISCORD_USER_ID_3,
			emoji: "🚀",
			externalAuthorDisplayName: "Taylor",
			externalAuthorAvatarUrl: "https://cdn.discordapp.com/avatars/discord-user-3/xyz.png",
		}

		const layer = makeWorkerLayer({
			connectionRepo: {
				findById: () =>
					Effect.succeed(
						Option.some({
							id: SYNC_CONNECTION_ID,
							organizationId: ORGANIZATION_ID,
							provider: "discord",
							status: "active",
						}),
					),
				updateLastSyncedAt: () => Effect.succeed({ id: SYNC_CONNECTION_ID }),
			} as unknown as ChatSyncConnectionRepo,
			channelLinkRepo: {
				findByExternalChannel: () =>
					Effect.succeed(
						Option.some({
							id: CHANNEL_LINK_ID,
							hazelChannelId: HAZEL_CHANNEL_ID,
						}),
					),
				updateLastSyncedAt: () => Effect.succeed({ id: CHANNEL_LINK_ID }),
			} as unknown as ChatSyncChannelLinkRepo,
			messageLinkRepo: {
				findByExternalMessage: () =>
					Effect.succeed(
						Option.some({
							channelLinkId: CHANNEL_LINK_ID,
							hazelMessageId: HAZEL_MESSAGE_ID,
							externalMessageId: DISCORD_MESSAGE_ID,
						}),
					),
			} as unknown as ChatSyncMessageLinkRepo,
			eventReceiptRepo: {
				claimByDedupeKey: () => Effect.succeed(true),
				updateByDedupeKey: () => Effect.succeed([]),
			} as unknown as ChatSyncEventReceiptRepo,
			messageRepo: {
				insert: () => Effect.succeed([]),
			} as unknown as MessageRepo,
			messageReactionRepo: {
				findByMessageUserEmoji: () =>
					Effect.succeed(
						Option.some({
							id: "00000000-0000-4000-8000-000000000008",
							messageId: HAZEL_MESSAGE_ID,
						}),
					),
				insert: () => Effect.succeed([]),
				deleteById: () => Effect.succeed([]),
			} as unknown as MessageReactionRepo,
			channelRepo: {} as unknown as ChannelRepo,
			integrationConnectionRepo: {
				findActiveUserByExternalAccountId: () => Effect.succeed(Option.none()),
			} as unknown as IntegrationConnectionRepo,
			userRepo: {
				upsertByExternalId: (
					data: { firstName: string; avatarUrl?: string | null },
					options: { syncAvatarUrl?: boolean } | undefined,
				) => {
					upsertPayload = {
						firstName: data.firstName,
						avatarUrl: data.avatarUrl ?? "",
					}
					upsertOptions = options ?? null
					return Effect.succeed({ id: REACTION_USER_ID })
				},
			} as unknown as UserRepo,
			organizationMemberRepo: {
				upsertByOrgAndUser: () => Effect.succeed({ id: REACTION_USER_ID }),
			} as unknown as OrganizationMemberRepo,
			integrationBotService: {
				getOrCreateBotUser: () => Effect.succeed({ id: BOT_USER_ID }),
			} as unknown as IntegrationBotService,
			channelAccessSyncService: {} as unknown as ChannelAccessSyncService,
		})

		const result = await runWorkerEffect(
			DiscordSyncWorker.ingestReactionRemove(payload).pipe(Effect.provide(layer)),
		)

		expect(result.status).toBe("deleted")
		const removePayload = upsertPayload as { firstName: string; avatarUrl: string } | null
		const removeOptions = upsertOptions as { syncAvatarUrl?: boolean } | null

		expect(removePayload?.firstName).toBe("Taylor")
		expect(removeOptions?.syncAvatarUrl).toBe(true)
	})
})

describe("DiscordSyncWorker inbound webhook origin filtering", () => {
	it("ignores created messages sent by configured outbound webhook", async () => {
		let messageInserted = false
		let externalLookupCalled = false
		let receiptStatus: string | undefined

		const layer = makeWorkerLayer({
			connectionRepo: {
				findById: () =>
					Effect.succeed(
						Option.some({
							id: SYNC_CONNECTION_ID,
							organizationId: ORGANIZATION_ID,
							provider: "discord",
							status: "active",
						}),
					),
			} as unknown as ChatSyncConnectionRepo,
			channelLinkRepo: {
				findByExternalChannel: () =>
					Effect.succeed(
						Option.some({
							id: CHANNEL_LINK_ID,
							hazelChannelId: HAZEL_CHANNEL_ID,
							settings: DISCORD_WEBHOOK_IDENTITY_SETTINGS,
						}),
					),
			} as unknown as ChatSyncChannelLinkRepo,
			messageLinkRepo: {
				findByExternalMessage: () => {
					externalLookupCalled = true
					return Effect.succeed(Option.none())
				},
			} as unknown as ChatSyncMessageLinkRepo,
			eventReceiptRepo: {
				claimByDedupeKey: () => Effect.succeed(true),
				updateByDedupeKey: (params: unknown) => {
					receiptStatus = (params as { status: string }).status
					return Effect.succeed([])
				},
			} as unknown as ChatSyncEventReceiptRepo,
			messageRepo: {
				insert: () => {
					messageInserted = true
					return Effect.succeed([])
				},
			} as unknown as MessageRepo,
			messageReactionRepo: {} as unknown as MessageReactionRepo,
			channelRepo: {} as unknown as ChannelRepo,
			integrationConnectionRepo: {} as unknown as IntegrationConnectionRepo,
			userRepo: {} as unknown as UserRepo,
			organizationMemberRepo: {} as unknown as OrganizationMemberRepo,
			integrationBotService: {} as unknown as IntegrationBotService,
			channelAccessSyncService: {} as unknown as ChannelAccessSyncService,
		})

		const result = await runWorkerEffect(
			DiscordSyncWorker.ingestMessageCreate({
				...PAYLOAD,
				externalWebhookId: DISCORD_WEBHOOK_ID,
			}).pipe(Effect.provide(layer)),
		)

		expect(result.status).toBe("ignored_webhook_origin")
		expect(externalLookupCalled).toBe(false)
		expect(messageInserted).toBe(false)
		expect(receiptStatus).toBe("ignored")
	})

	it("ignores updated messages sent by configured outbound webhook", async () => {
		let externalLookupCalled = false

		const layer = makeWorkerLayer({
			connectionRepo: {
				findById: () =>
					Effect.succeed(
						Option.some({
							id: SYNC_CONNECTION_ID,
							organizationId: ORGANIZATION_ID,
							provider: "discord",
							status: "active",
						}),
					),
			} as unknown as ChatSyncConnectionRepo,
			channelLinkRepo: {
				findByExternalChannel: () =>
					Effect.succeed(
						Option.some({
							id: CHANNEL_LINK_ID,
							hazelChannelId: HAZEL_CHANNEL_ID,
							settings: DISCORD_WEBHOOK_IDENTITY_SETTINGS,
						}),
					),
			} as unknown as ChatSyncChannelLinkRepo,
			messageLinkRepo: {
				findByExternalMessage: () => {
					externalLookupCalled = true
					return Effect.succeed(Option.none())
				},
			} as unknown as ChatSyncMessageLinkRepo,
			eventReceiptRepo: {
				claimByDedupeKey: () => Effect.succeed(true),
				updateByDedupeKey: () => Effect.succeed([]),
			} as unknown as ChatSyncEventReceiptRepo,
			messageRepo: {} as unknown as MessageRepo,
			messageReactionRepo: {} as unknown as MessageReactionRepo,
			channelRepo: {} as unknown as ChannelRepo,
			integrationConnectionRepo: {} as unknown as IntegrationConnectionRepo,
			userRepo: {} as unknown as UserRepo,
			organizationMemberRepo: {} as unknown as OrganizationMemberRepo,
			integrationBotService: {} as unknown as IntegrationBotService,
			channelAccessSyncService: {} as unknown as ChannelAccessSyncService,
		})

		const result = await runWorkerEffect(
			DiscordSyncWorker.ingestMessageUpdate({
				syncConnectionId: SYNC_CONNECTION_ID,
				externalChannelId: DISCORD_CHANNEL_ID,
				externalMessageId: DISCORD_MESSAGE_ID,
				externalWebhookId: DISCORD_WEBHOOK_ID,
				content: "updated",
			}).pipe(Effect.provide(layer)),
		)

		expect(result.status).toBe("ignored_webhook_origin")
		expect(externalLookupCalled).toBe(false)
	})

	it("ignores deleted messages sent by configured outbound webhook", async () => {
		let externalLookupCalled = false

		const layer = makeWorkerLayer({
			connectionRepo: {
				findById: () =>
					Effect.succeed(
						Option.some({
							id: SYNC_CONNECTION_ID,
							organizationId: ORGANIZATION_ID,
							provider: "discord",
							status: "active",
						}),
					),
			} as unknown as ChatSyncConnectionRepo,
			channelLinkRepo: {
				findByExternalChannel: () =>
					Effect.succeed(
						Option.some({
							id: CHANNEL_LINK_ID,
							hazelChannelId: HAZEL_CHANNEL_ID,
							settings: DISCORD_WEBHOOK_IDENTITY_SETTINGS,
						}),
					),
			} as unknown as ChatSyncChannelLinkRepo,
			messageLinkRepo: {
				findByExternalMessage: () => {
					externalLookupCalled = true
					return Effect.succeed(Option.none())
				},
			} as unknown as ChatSyncMessageLinkRepo,
			eventReceiptRepo: {
				claimByDedupeKey: () => Effect.succeed(true),
				updateByDedupeKey: () => Effect.succeed([]),
			} as unknown as ChatSyncEventReceiptRepo,
			messageRepo: {} as unknown as MessageRepo,
			messageReactionRepo: {} as unknown as MessageReactionRepo,
			channelRepo: {} as unknown as ChannelRepo,
			integrationConnectionRepo: {} as unknown as IntegrationConnectionRepo,
			userRepo: {} as unknown as UserRepo,
			organizationMemberRepo: {} as unknown as OrganizationMemberRepo,
			integrationBotService: {} as unknown as IntegrationBotService,
			channelAccessSyncService: {} as unknown as ChannelAccessSyncService,
		})

		const result = await runWorkerEffect(
			DiscordSyncWorker.ingestMessageDelete({
				syncConnectionId: SYNC_CONNECTION_ID,
				externalChannelId: DISCORD_CHANNEL_ID,
				externalMessageId: DISCORD_MESSAGE_ID,
				externalWebhookId: DISCORD_WEBHOOK_ID,
			}).pipe(Effect.provide(layer)),
		)

		expect(result.status).toBe("ignored_webhook_origin")
		expect(externalLookupCalled).toBe(false)
	})
})

describe("DiscordSyncWorker outbound webhook dispatch", () => {
	it("creates hazel messages through webhook when outbound identity is configured", async () => {
		let webhookCalled = false
		let adapterCreateCalled = false
		let insertedExternalMessageId: string | null = null
		const executeWebhookMessage = ({
			webhookId,
			webhookToken,
		}: {
			webhookId: string
			webhookToken: string
		}) => {
			webhookCalled = true
			expect(webhookId).toBe(DISCORD_WEBHOOK_ID)
			expect(webhookToken).toBe(DISCORD_WEBHOOK_TOKEN)
			return Effect.succeed(DISCORD_WEBHOOK_MESSAGE_ID)
		}
		const providerAdapter = {
			provider: "discord",
			createMessage: () => {
				adapterCreateCalled = true
				return Effect.fail(new Error("should not create via bot API"))
			},
			updateMessage: () => Effect.succeed(undefined),
			deleteMessage: () => Effect.succeed(undefined),
			addReaction: () => Effect.succeed(undefined),
			removeReaction: () => Effect.succeed(undefined),
			createThread: () => Effect.succeed("thread-id"),
		}
		const layer = makeWorkerLayerWithOverrides({
			connectionRepo: {
				findById: () =>
					Effect.succeed(
						Option.some({
							id: SYNC_CONNECTION_ID,
							organizationId: ORGANIZATION_ID,
							provider: "discord",
							status: "active",
						}),
					),
				updateLastSyncedAt: () => Effect.succeed([]),
			} as unknown as ChatSyncConnectionRepo,
			channelLinkRepo: {
				findByHazelChannel: () =>
					Effect.succeed(
						Option.some({
							id: CHANNEL_LINK_ID,
							externalChannelId: DISCORD_CHANNEL_ID,
							hazelChannelId: HAZEL_CHANNEL_ID,
							settings: DISCORD_WEBHOOK_IDENTITY_SETTINGS,
						}),
					),
				updateLastSyncedAt: () => Effect.succeed([]),
				updateSettings: () => Effect.succeed([]),
			} as unknown as ChatSyncChannelLinkRepo,
			messageLinkRepo: {
				findByHazelMessage: () => Effect.succeed(Option.none()),
				insert: (payload: {
					channelLinkId: SyncChannelLinkId
					externalMessageId: ExternalMessageId
				}) => {
					insertedExternalMessageId = payload.externalMessageId
					return Effect.succeed([{ id: "message-link-id", channelLinkId: payload.channelLinkId }])
				},
			} as unknown as ChatSyncMessageLinkRepo,
			eventReceiptRepo: {
				claimByDedupeKey: () => Effect.succeed(true),
				updateByDedupeKey: () => Effect.succeed([]),
			} as unknown as ChatSyncEventReceiptRepo,
			messageRepo: {
				findById: () =>
					Effect.succeed(
						Option.some({
							id: HAZEL_MESSAGE_ID,
							channelId: HAZEL_CHANNEL_ID,
							authorId: BOT_USER_ID,
							content: "hello from hazel",
							replyToMessageId: null,
							threadChannelId: null,
						}),
					),
			} as unknown as MessageRepo,
			messageReactionRepo: {} as unknown as MessageReactionRepo,
			channelRepo: {} as unknown as ChannelRepo,
			integrationConnectionRepo: {} as unknown as IntegrationConnectionRepo,
			userRepo: {
				findById: () =>
					Effect.succeed(
						Option.some({
							id: BOT_USER_ID,
							firstName: "Alex",
							lastName: "Doe",
							avatarUrl: "https://avatar.example/discord",
						}),
					),
			} as unknown as UserRepo,
			organizationMemberRepo: {} as unknown as OrganizationMemberRepo,
			integrationBotService: {
				getOrCreateBotUser: () => Effect.succeed({ id: BOT_USER_ID }),
			} as unknown as IntegrationBotService,
			channelAccessSyncService: {} as unknown as ChannelAccessSyncService,
			providerRegistry: {
				getAdapter: () => Effect.succeed(providerAdapter),
			} as unknown as ChatSyncProviderRegistry,
			discordApiClient: {
				executeWebhookMessage,
				createWebhook: () => Effect.fail(new Error("webhook should already be configured")),
				updateWebhookMessage: () => Effect.succeed(undefined),
				deleteWebhookMessage: () => Effect.succeed(undefined),
			} as unknown as Discord.DiscordApiClient,
		})

		const result = await runWorkerEffect(
			DiscordSyncWorker.syncHazelMessageToDiscord(SYNC_CONNECTION_ID, HAZEL_MESSAGE_ID).pipe(
				Effect.provide(layer),
			),
		)

		expect(result.status).toBe("synced")
		expect(result.externalMessageId).toBe(DISCORD_WEBHOOK_MESSAGE_ID)
		expect(webhookCalled).toBe(true)
		expect(adapterCreateCalled).toBe(false)
		expect(insertedExternalMessageId).toBe(DISCORD_WEBHOOK_MESSAGE_ID)
	})

	it("translates synced and unsynced user mentions before webhook create", async () => {
		let receivedWebhookContent: string | null = null
		const layer = makeWorkerLayerWithOverrides({
			connectionRepo: {
				findById: () =>
					Effect.succeed(
						Option.some({
							id: SYNC_CONNECTION_ID,
							organizationId: ORGANIZATION_ID,
							provider: "discord",
							status: "active",
						}),
					),
				updateLastSyncedAt: () => Effect.succeed([]),
			} as unknown as ChatSyncConnectionRepo,
			channelLinkRepo: {
				findByHazelChannel: () =>
					Effect.succeed(
						Option.some({
							id: CHANNEL_LINK_ID,
							externalChannelId: DISCORD_CHANNEL_ID,
							hazelChannelId: HAZEL_CHANNEL_ID,
							settings: DISCORD_WEBHOOK_IDENTITY_SETTINGS,
						}),
					),
				updateLastSyncedAt: () => Effect.succeed([]),
				updateSettings: () => Effect.succeed([]),
			} as unknown as ChatSyncChannelLinkRepo,
			messageLinkRepo: {
				findByHazelMessage: () => Effect.succeed(Option.none()),
				insert: () => Effect.succeed([{ id: "message-link-id" }]),
			} as unknown as ChatSyncMessageLinkRepo,
			eventReceiptRepo: {
				claimByDedupeKey: () => Effect.succeed(true),
				updateByDedupeKey: () => Effect.succeed([]),
			} as unknown as ChatSyncEventReceiptRepo,
			messageRepo: {
				findById: () =>
					Effect.succeed(
						Option.some({
							id: HAZEL_MESSAGE_ID,
							channelId: HAZEL_CHANNEL_ID,
							authorId: BOT_USER_ID,
							content: `Hi @[userId:${SYNCED_MENTION_USER_ID}] @[userId:${UNSYNCED_MENTION_USER_ID}] @[userId:${INACTIVE_MENTION_USER_ID}] @[directive:here]`,
							replyToMessageId: null,
							threadChannelId: null,
						}),
					),
			} as unknown as MessageRepo,
			messageReactionRepo: {} as unknown as MessageReactionRepo,
			channelRepo: {} as unknown as ChannelRepo,
			integrationConnectionRepo: {
				findUserConnection: (_organizationId: OrganizationId, userId: UserId) => {
					if (userId === SYNCED_MENTION_USER_ID) {
						return Effect.succeed(
							Option.some({
								status: "active",
								externalAccountId: "444444444444444444",
							}),
						)
					}

					if (userId === INACTIVE_MENTION_USER_ID) {
						return Effect.succeed(
							Option.some({
								status: "revoked",
								externalAccountId: "555555555555555555",
							}),
						)
					}

					return Effect.succeed(Option.none())
				},
			} as unknown as IntegrationConnectionRepo,
			userRepo: {
				findById: (userId: UserId) => {
					if (userId === BOT_USER_ID) {
						return Effect.succeed(
							Option.some({
								id: BOT_USER_ID,
								firstName: "Alex",
								lastName: "Doe",
								avatarUrl: "https://avatar.example/discord",
							}),
						)
					}

					if (userId === SYNCED_MENTION_USER_ID) {
						return Effect.succeed(
							Option.some({
								id: SYNCED_MENTION_USER_ID,
								firstName: "Synced",
								lastName: "User",
								avatarUrl: "",
							}),
						)
					}

					if (userId === UNSYNCED_MENTION_USER_ID) {
						return Effect.succeed(
							Option.some({
								id: UNSYNCED_MENTION_USER_ID,
								firstName: "Taylor",
								lastName: "Plain",
								avatarUrl: "",
							}),
						)
					}

					if (userId === INACTIVE_MENTION_USER_ID) {
						return Effect.succeed(
							Option.some({
								id: INACTIVE_MENTION_USER_ID,
								firstName: "Casey",
								lastName: "Offline",
								avatarUrl: "",
							}),
						)
					}

					return Effect.succeed(Option.none())
				},
			} as unknown as UserRepo,
			organizationMemberRepo: {} as unknown as OrganizationMemberRepo,
			integrationBotService: {
				getOrCreateBotUser: () => Effect.succeed({ id: BOT_USER_ID }),
			} as unknown as IntegrationBotService,
			channelAccessSyncService: {} as unknown as ChannelAccessSyncService,
			providerRegistry: {
				getAdapter: () =>
					Effect.succeed({
						provider: "discord",
						createMessage: () => Effect.fail(new Error("should not call bot create")),
						updateMessage: () => Effect.succeed(undefined),
						deleteMessage: () => Effect.succeed(undefined),
						addReaction: () => Effect.succeed(undefined),
						removeReaction: () => Effect.succeed(undefined),
						createThread: () => Effect.succeed("thread-id"),
					}),
			} as unknown as ChatSyncProviderRegistry,
			discordApiClient: {
				executeWebhookMessage: ({ content }: { content: string }) => {
					receivedWebhookContent = content
					return Effect.succeed(DISCORD_WEBHOOK_MESSAGE_ID)
				},
				createWebhook: () => Effect.fail(new Error("webhook should already be configured")),
				updateWebhookMessage: () => Effect.succeed(undefined),
				deleteWebhookMessage: () => Effect.succeed(undefined),
			} as unknown as Discord.DiscordApiClient,
		})

		const result = await runWorkerEffect(
			DiscordSyncWorker.syncHazelMessageToDiscord(SYNC_CONNECTION_ID, HAZEL_MESSAGE_ID).pipe(
				Effect.provide(layer),
			),
		)

		expect(result.status).toBe("synced")
		expect(receivedWebhookContent).toBe(
			"Hi <@444444444444444444> @Taylor Plain @Casey Offline @[directive:here]",
		)
	})

	it("falls back to display names when bot create cannot build a real Discord mention", async () => {
		let receivedCreateContent: string | null = null
		const layer = makeWorkerLayerWithOverrides({
			connectionRepo: {
				findById: () =>
					Effect.succeed(
						Option.some({
							id: SYNC_CONNECTION_ID,
							organizationId: ORGANIZATION_ID,
							provider: "discord",
							status: "active",
						}),
					),
				updateLastSyncedAt: () => Effect.succeed([]),
			} as unknown as ChatSyncConnectionRepo,
			channelLinkRepo: {
				findByHazelChannel: () =>
					Effect.succeed(
						Option.some({
							id: CHANNEL_LINK_ID,
							externalChannelId: DISCORD_CHANNEL_ID,
							hazelChannelId: HAZEL_CHANNEL_ID,
							settings: DISCORD_FALLBACK_BOT_SETTINGS,
						}),
					),
				updateLastSyncedAt: () => Effect.succeed([]),
			} as unknown as ChatSyncChannelLinkRepo,
			messageLinkRepo: {
				findByHazelMessage: () => Effect.succeed(Option.none()),
				insert: () => Effect.succeed([{ id: "message-link-id" }]),
			} as unknown as ChatSyncMessageLinkRepo,
			eventReceiptRepo: {
				claimByDedupeKey: () => Effect.succeed(true),
				updateByDedupeKey: () => Effect.succeed([]),
			} as unknown as ChatSyncEventReceiptRepo,
			messageRepo: {
				findById: () =>
					Effect.succeed(
						Option.some({
							id: HAZEL_MESSAGE_ID,
							channelId: HAZEL_CHANNEL_ID,
							authorId: BOT_USER_ID,
							content: `Hello @[userId:${MISSING_EXTERNAL_MENTION_USER_ID}]`,
							replyToMessageId: null,
							threadChannelId: null,
						}),
					),
			} as unknown as MessageRepo,
			messageReactionRepo: {} as unknown as MessageReactionRepo,
			channelRepo: {} as unknown as ChannelRepo,
			integrationConnectionRepo: {
				findUserConnection: (_organizationId: OrganizationId, userId: UserId) => {
					if (userId === MISSING_EXTERNAL_MENTION_USER_ID) {
						return Effect.succeed(
							Option.some({
								status: "active",
								externalAccountId: null,
							}),
						)
					}

					return Effect.succeed(Option.none())
				},
			} as unknown as IntegrationConnectionRepo,
			userRepo: {
				findById: (userId: UserId) => {
					if (userId === BOT_USER_ID) {
						return Effect.succeed(
							Option.some({
								id: BOT_USER_ID,
								firstName: "Alex",
								lastName: "Doe",
								avatarUrl: "https://avatar.example/discord",
							}),
						)
					}

					if (userId === MISSING_EXTERNAL_MENTION_USER_ID) {
						return Effect.succeed(
							Option.some({
								id: MISSING_EXTERNAL_MENTION_USER_ID,
								firstName: "Morgan",
								lastName: "Fallback",
								avatarUrl: "",
							}),
						)
					}

					return Effect.succeed(Option.none())
				},
			} as unknown as UserRepo,
			organizationMemberRepo: {} as unknown as OrganizationMemberRepo,
			integrationBotService: {
				getOrCreateBotUser: () => Effect.succeed({ id: BOT_USER_ID }),
			} as unknown as IntegrationBotService,
			channelAccessSyncService: {} as unknown as ChannelAccessSyncService,
			providerRegistry: {
				getAdapter: () =>
					Effect.succeed({
						provider: "discord",
						createMessage: ({ content }: { content: string }) => {
							receivedCreateContent = content
							return Effect.succeed(DISCORD_MESSAGE_ID)
						},
						updateMessage: () => Effect.succeed(undefined),
						deleteMessage: () => Effect.succeed(undefined),
						addReaction: () => Effect.succeed(undefined),
						removeReaction: () => Effect.succeed(undefined),
						createThread: () => Effect.succeed("thread-id"),
					}),
			} as unknown as ChatSyncProviderRegistry,
			discordApiClient: {
				executeWebhookMessage: () => Effect.fail(new Error("should not execute webhook")),
				createWebhook: () => Effect.fail(new Error("should not create webhook")),
				updateWebhookMessage: () => Effect.succeed(undefined),
				deleteWebhookMessage: () => Effect.succeed(undefined),
			} as unknown as Discord.DiscordApiClient,
		})

		const result = await runWorkerEffect(
			DiscordSyncWorker.syncHazelMessageToDiscord(SYNC_CONNECTION_ID, HAZEL_MESSAGE_ID).pipe(
				Effect.provide(layer),
			),
		)

		expect(result.status).toBe("synced")
		expect(receivedCreateContent).toBe("Hello @Morgan Fallback")
	})

	it("updates existing hazel messages through webhook", async () => {
		let updateWebhookCalled = false
		let updateMessageCalled = false
		const layer = makeWorkerLayerWithOverrides({
			connectionRepo: {
				findById: () =>
					Effect.succeed(
						Option.some({
							id: SYNC_CONNECTION_ID,
							organizationId: ORGANIZATION_ID,
							provider: "discord",
							status: "active",
						}),
					),
				updateLastSyncedAt: () => Effect.succeed([]),
			} as unknown as ChatSyncConnectionRepo,
			channelLinkRepo: {
				findByHazelChannel: () =>
					Effect.succeed(
						Option.some({
							id: CHANNEL_LINK_ID,
							externalChannelId: DISCORD_CHANNEL_ID,
							hazelChannelId: HAZEL_CHANNEL_ID,
							settings: DISCORD_WEBHOOK_IDENTITY_SETTINGS,
						}),
					),
				updateLastSyncedAt: () => Effect.succeed([]),
			} as unknown as ChatSyncChannelLinkRepo,
			messageLinkRepo: {
				findByHazelMessage: () =>
					Effect.succeed(
						Option.some({
							id: "message-link-id",
							channelLinkId: CHANNEL_LINK_ID,
							externalMessageId: DISCORD_WEBHOOK_MESSAGE_ID,
						}),
					),
				updateLastSyncedAt: () => Effect.succeed([]),
			} as unknown as ChatSyncMessageLinkRepo,
			eventReceiptRepo: {
				claimByDedupeKey: () => Effect.succeed(true),
				updateByDedupeKey: () => Effect.succeed([]),
			} as unknown as ChatSyncEventReceiptRepo,
			messageRepo: {
				findById: () =>
					Effect.succeed(
						Option.some({
							id: HAZEL_MESSAGE_ID,
							channelId: HAZEL_CHANNEL_ID,
							authorId: BOT_USER_ID,
							content: "updated",
							replyToMessageId: null,
							threadChannelId: null,
						}),
					),
			} as unknown as MessageRepo,
			messageReactionRepo: {} as unknown as MessageReactionRepo,
			channelRepo: {} as unknown as ChannelRepo,
			integrationConnectionRepo: {} as unknown as IntegrationConnectionRepo,
			userRepo: {
				findById: () =>
					Effect.succeed(
						Option.some({
							id: BOT_USER_ID,
							firstName: "Alex",
							lastName: "Doe",
							avatarUrl: "https://avatar.example/discord",
						}),
					),
			} as unknown as UserRepo,
			organizationMemberRepo: {} as unknown as OrganizationMemberRepo,
			integrationBotService: {
				getOrCreateBotUser: () => Effect.succeed({ id: BOT_USER_ID }),
			} as unknown as IntegrationBotService,
			channelAccessSyncService: {} as unknown as ChannelAccessSyncService,
			providerRegistry: {
				getAdapter: () =>
					Effect.succeed({
						provider: "discord",
						createMessage: () => Effect.fail(new Error("should not call bot create")),
						updateMessage: () => {
							updateMessageCalled = true
							return Effect.succeed(undefined)
						},
						deleteMessage: () => Effect.succeed(undefined),
						addReaction: () => Effect.succeed(undefined),
						removeReaction: () => Effect.succeed(undefined),
						createThread: () => Effect.succeed("thread-id"),
					}),
			} as unknown as ChatSyncProviderRegistry,
			discordApiClient: {
				updateWebhookMessage: ({
					webhookId,
					webhookToken,
					webhookMessageId,
				}: {
					webhookId: string
					webhookToken: string
					webhookMessageId: string
				}) => {
					updateWebhookCalled = true
					expect(webhookId).toBe(DISCORD_WEBHOOK_ID)
					expect(webhookToken).toBe(DISCORD_WEBHOOK_TOKEN)
					expect(webhookMessageId).toBe(DISCORD_WEBHOOK_MESSAGE_ID)
					return Effect.succeed(undefined)
				},
				createWebhook: () => Effect.fail(new Error("not expected")),
				executeWebhookMessage: () => Effect.fail(new Error("not expected")),
				deleteWebhookMessage: () => Effect.succeed(undefined),
			} as unknown as Discord.DiscordApiClient,
		})

		const result = await runWorkerEffect(
			DiscordSyncWorker.syncHazelMessageUpdateToDiscord(SYNC_CONNECTION_ID, HAZEL_MESSAGE_ID).pipe(
				Effect.provide(layer),
			),
		)

		expect(result.status).toBe("updated")
		expect(result.externalMessageId).toBe(DISCORD_WEBHOOK_MESSAGE_ID)
		expect(updateWebhookCalled).toBe(true)
		expect(updateMessageCalled).toBe(false)
	})

	it("translates mentions before webhook update", async () => {
		let receivedUpdateContent: string | null = null
		const layer = makeWorkerLayerWithOverrides({
			connectionRepo: {
				findById: () =>
					Effect.succeed(
						Option.some({
							id: SYNC_CONNECTION_ID,
							organizationId: ORGANIZATION_ID,
							provider: "discord",
							status: "active",
						}),
					),
				updateLastSyncedAt: () => Effect.succeed([]),
			} as unknown as ChatSyncConnectionRepo,
			channelLinkRepo: {
				findByHazelChannel: () =>
					Effect.succeed(
						Option.some({
							id: CHANNEL_LINK_ID,
							externalChannelId: DISCORD_CHANNEL_ID,
							hazelChannelId: HAZEL_CHANNEL_ID,
							settings: DISCORD_WEBHOOK_IDENTITY_SETTINGS,
						}),
					),
				updateLastSyncedAt: () => Effect.succeed([]),
			} as unknown as ChatSyncChannelLinkRepo,
			messageLinkRepo: {
				findByHazelMessage: () =>
					Effect.succeed(
						Option.some({
							id: "message-link-id",
							channelLinkId: CHANNEL_LINK_ID,
							externalMessageId: DISCORD_WEBHOOK_MESSAGE_ID,
						}),
					),
				updateLastSyncedAt: () => Effect.succeed([]),
			} as unknown as ChatSyncMessageLinkRepo,
			eventReceiptRepo: {
				claimByDedupeKey: () => Effect.succeed(true),
				updateByDedupeKey: () => Effect.succeed([]),
			} as unknown as ChatSyncEventReceiptRepo,
			messageRepo: {
				findById: () =>
					Effect.succeed(
						Option.some({
							id: HAZEL_MESSAGE_ID,
							channelId: HAZEL_CHANNEL_ID,
							authorId: BOT_USER_ID,
							content: `Updated @[userId:${SYNCED_MENTION_USER_ID}] @[userId:${UNSYNCED_MENTION_USER_ID}]`,
							replyToMessageId: null,
							threadChannelId: null,
						}),
					),
			} as unknown as MessageRepo,
			messageReactionRepo: {} as unknown as MessageReactionRepo,
			channelRepo: {} as unknown as ChannelRepo,
			integrationConnectionRepo: {
				findUserConnection: (_organizationId: OrganizationId, userId: UserId) => {
					if (userId === SYNCED_MENTION_USER_ID) {
						return Effect.succeed(
							Option.some({
								status: "active",
								externalAccountId: "666666666666666666",
							}),
						)
					}

					return Effect.succeed(Option.none())
				},
			} as unknown as IntegrationConnectionRepo,
			userRepo: {
				findById: (userId: UserId) => {
					if (userId === BOT_USER_ID) {
						return Effect.succeed(
							Option.some({
								id: BOT_USER_ID,
								firstName: "Alex",
								lastName: "Doe",
								avatarUrl: "https://avatar.example/discord",
							}),
						)
					}

					if (userId === SYNCED_MENTION_USER_ID) {
						return Effect.succeed(
							Option.some({
								id: SYNCED_MENTION_USER_ID,
								firstName: "Synced",
								lastName: "User",
								avatarUrl: "",
							}),
						)
					}

					if (userId === UNSYNCED_MENTION_USER_ID) {
						return Effect.succeed(
							Option.some({
								id: UNSYNCED_MENTION_USER_ID,
								firstName: "Taylor",
								lastName: "Plain",
								avatarUrl: "",
							}),
						)
					}

					return Effect.succeed(Option.none())
				},
			} as unknown as UserRepo,
			organizationMemberRepo: {} as unknown as OrganizationMemberRepo,
			integrationBotService: {
				getOrCreateBotUser: () => Effect.succeed({ id: BOT_USER_ID }),
			} as unknown as IntegrationBotService,
			channelAccessSyncService: {} as unknown as ChannelAccessSyncService,
			providerRegistry: {
				getAdapter: () =>
					Effect.succeed({
						provider: "discord",
						createMessage: () => Effect.fail(new Error("should not call bot create")),
						updateMessage: () => Effect.succeed(undefined),
						deleteMessage: () => Effect.succeed(undefined),
						addReaction: () => Effect.succeed(undefined),
						removeReaction: () => Effect.succeed(undefined),
						createThread: () => Effect.succeed("thread-id"),
					}),
			} as unknown as ChatSyncProviderRegistry,
			discordApiClient: {
				updateWebhookMessage: ({ content }: { content: string }) => {
					receivedUpdateContent = content
					return Effect.succeed(undefined)
				},
				createWebhook: () => Effect.fail(new Error("not expected")),
				executeWebhookMessage: () => Effect.fail(new Error("not expected")),
				deleteWebhookMessage: () => Effect.succeed(undefined),
			} as unknown as Discord.DiscordApiClient,
		})

		const result = await runWorkerEffect(
			DiscordSyncWorker.syncHazelMessageUpdateToDiscord(SYNC_CONNECTION_ID, HAZEL_MESSAGE_ID).pipe(
				Effect.provide(layer),
			),
		)

		expect(result.status).toBe("updated")
		expect(receivedUpdateContent).toBe("Updated <@666666666666666666> @Taylor Plain")
	})

	it("falls back to unknown-user when bot update cannot resolve a display name", async () => {
		let receivedUpdateContent: string | null = null
		const layer = makeWorkerLayerWithOverrides({
			connectionRepo: {
				findById: () =>
					Effect.succeed(
						Option.some({
							id: SYNC_CONNECTION_ID,
							organizationId: ORGANIZATION_ID,
							provider: "discord",
							status: "active",
						}),
					),
				updateLastSyncedAt: () => Effect.succeed([]),
			} as unknown as ChatSyncConnectionRepo,
			channelLinkRepo: {
				findByHazelChannel: () =>
					Effect.succeed(
						Option.some({
							id: CHANNEL_LINK_ID,
							externalChannelId: DISCORD_CHANNEL_ID,
							hazelChannelId: HAZEL_CHANNEL_ID,
							settings: DISCORD_FALLBACK_BOT_SETTINGS,
						}),
					),
				updateLastSyncedAt: () => Effect.succeed([]),
			} as unknown as ChatSyncChannelLinkRepo,
			messageLinkRepo: {
				findByHazelMessage: () =>
					Effect.succeed(
						Option.some({
							id: "message-link-id",
							channelLinkId: CHANNEL_LINK_ID,
							externalMessageId: DISCORD_MESSAGE_ID,
						}),
					),
				updateLastSyncedAt: () => Effect.succeed([]),
			} as unknown as ChatSyncMessageLinkRepo,
			eventReceiptRepo: {
				claimByDedupeKey: () => Effect.succeed(true),
				updateByDedupeKey: () => Effect.succeed([]),
			} as unknown as ChatSyncEventReceiptRepo,
			messageRepo: {
				findById: () =>
					Effect.succeed(
						Option.some({
							id: HAZEL_MESSAGE_ID,
							channelId: HAZEL_CHANNEL_ID,
							authorId: BOT_USER_ID,
							content: `Ping @[userId:${UNKNOWN_MENTION_USER_ID}]`,
							replyToMessageId: null,
							threadChannelId: null,
						}),
					),
			} as unknown as MessageRepo,
			messageReactionRepo: {} as unknown as MessageReactionRepo,
			channelRepo: {} as unknown as ChannelRepo,
			integrationConnectionRepo: {
				findUserConnection: () => Effect.succeed(Option.none()),
			} as unknown as IntegrationConnectionRepo,
			userRepo: {
				findById: (userId: UserId) => {
					if (userId === BOT_USER_ID) {
						return Effect.succeed(
							Option.some({
								id: BOT_USER_ID,
								firstName: "Alex",
								lastName: "Doe",
								avatarUrl: "https://avatar.example/discord",
							}),
						)
					}

					return Effect.succeed(Option.none())
				},
			} as unknown as UserRepo,
			organizationMemberRepo: {} as unknown as OrganizationMemberRepo,
			integrationBotService: {
				getOrCreateBotUser: () => Effect.succeed({ id: BOT_USER_ID }),
			} as unknown as IntegrationBotService,
			channelAccessSyncService: {} as unknown as ChannelAccessSyncService,
			providerRegistry: {
				getAdapter: () =>
					Effect.succeed({
						provider: "discord",
						createMessage: () => Effect.fail(new Error("should not call bot create")),
						updateMessage: ({ content }: { content: string }) => {
							receivedUpdateContent = content
							return Effect.succeed(undefined)
						},
						deleteMessage: () => Effect.succeed(undefined),
						addReaction: () => Effect.succeed(undefined),
						removeReaction: () => Effect.succeed(undefined),
						createThread: () => Effect.succeed("thread-id"),
					}),
			} as unknown as ChatSyncProviderRegistry,
			discordApiClient: {
				updateWebhookMessage: () => Effect.fail(new Error("should not update webhook")),
				createWebhook: () => Effect.fail(new Error("not expected")),
				executeWebhookMessage: () => Effect.fail(new Error("not expected")),
				deleteWebhookMessage: () => Effect.succeed(undefined),
			} as unknown as Discord.DiscordApiClient,
		})

		const result = await runWorkerEffect(
			DiscordSyncWorker.syncHazelMessageUpdateToDiscord(SYNC_CONNECTION_ID, HAZEL_MESSAGE_ID).pipe(
				Effect.provide(layer),
			),
		)

		expect(result.status).toBe("updated")
		expect(receivedUpdateContent).toBe("Ping @unknown-user")
	})

	it("deletes hazel messages through webhook", async () => {
		let deleteWebhookCalled = false
		let deleteMessageCalled = false
		const layer = makeWorkerLayerWithOverrides({
			connectionRepo: {
				findById: () =>
					Effect.succeed(
						Option.some({
							id: SYNC_CONNECTION_ID,
							organizationId: ORGANIZATION_ID,
							provider: "discord",
							status: "active",
						}),
					),
				updateLastSyncedAt: () => Effect.succeed([]),
			} as unknown as ChatSyncConnectionRepo,
			channelLinkRepo: {
				findByHazelChannel: () =>
					Effect.succeed(
						Option.some({
							id: CHANNEL_LINK_ID,
							externalChannelId: DISCORD_CHANNEL_ID,
							hazelChannelId: HAZEL_CHANNEL_ID,
							settings: DISCORD_WEBHOOK_IDENTITY_SETTINGS,
						}),
					),
				updateLastSyncedAt: () => Effect.succeed([]),
			} as unknown as ChatSyncChannelLinkRepo,
			messageLinkRepo: {
				findByHazelMessage: () =>
					Effect.succeed(
						Option.some({
							id: "message-link-id",
							channelLinkId: CHANNEL_LINK_ID,
							externalMessageId: DISCORD_WEBHOOK_MESSAGE_ID,
						}),
					),
				softDelete: () => Effect.succeed([{ id: "message-link-id" }]),
				updateLastSyncedAt: () => Effect.succeed([]),
			} as unknown as ChatSyncMessageLinkRepo,
			eventReceiptRepo: {
				claimByDedupeKey: () => Effect.succeed(true),
				updateByDedupeKey: () => Effect.succeed([]),
			} as unknown as ChatSyncEventReceiptRepo,
			messageRepo: {
				findById: () =>
					Effect.succeed(
						Option.some({
							id: HAZEL_MESSAGE_ID,
							channelId: HAZEL_CHANNEL_ID,
							authorId: BOT_USER_ID,
							content: "to delete",
							replyToMessageId: null,
							threadChannelId: null,
						}),
					),
			} as unknown as MessageRepo,
			messageReactionRepo: {} as unknown as MessageReactionRepo,
			channelRepo: {} as unknown as ChannelRepo,
			integrationConnectionRepo: {} as unknown as IntegrationConnectionRepo,
			userRepo: {
				findById: () =>
					Effect.succeed(
						Option.some({
							id: BOT_USER_ID,
							firstName: "Alex",
							lastName: "Doe",
							avatarUrl: "https://avatar.example/discord",
						}),
					),
			} as unknown as UserRepo,
			organizationMemberRepo: {} as unknown as OrganizationMemberRepo,
			integrationBotService: {
				getOrCreateBotUser: () => Effect.succeed({ id: BOT_USER_ID }),
			} as unknown as IntegrationBotService,
			channelAccessSyncService: {} as unknown as ChannelAccessSyncService,
			providerRegistry: {
				getAdapter: () =>
					Effect.succeed({
						provider: "discord",
						createMessage: () => Effect.succeed("fallback-bot-id"),
						updateMessage: () => {
							return Effect.fail(new Error("should not call bot update"))
						},
						deleteMessage: () => {
							deleteMessageCalled = true
							return Effect.succeed(undefined)
						},
						addReaction: () => Effect.succeed(undefined),
						removeReaction: () => Effect.succeed(undefined),
						createThread: () => Effect.succeed("thread-id"),
					}),
			} as unknown as ChatSyncProviderRegistry,
			discordApiClient: {
				deleteWebhookMessage: ({
					webhookId,
					webhookToken,
					webhookMessageId,
				}: {
					webhookId: string
					webhookToken: string
					webhookMessageId: string
				}) => {
					deleteWebhookCalled = true
					expect(webhookId).toBe(DISCORD_WEBHOOK_ID)
					expect(webhookToken).toBe(DISCORD_WEBHOOK_TOKEN)
					expect(webhookMessageId).toBe(DISCORD_WEBHOOK_MESSAGE_ID)
					return Effect.succeed(undefined)
				},
				createWebhook: () => Effect.fail(new Error("not expected")),
				executeWebhookMessage: () => Effect.fail(new Error("not expected")),
				updateWebhookMessage: () => Effect.succeed(undefined),
			} as unknown as Discord.DiscordApiClient,
		})

		const result = await runWorkerEffect(
			DiscordSyncWorker.syncHazelMessageDeleteToDiscord(SYNC_CONNECTION_ID, HAZEL_MESSAGE_ID).pipe(
				Effect.provide(layer),
			),
		)

		expect(result.status).toBe("deleted")
		expect(result.externalMessageId).toBe(DISCORD_WEBHOOK_MESSAGE_ID)
		expect(deleteWebhookCalled).toBe(true)
		expect(deleteMessageCalled).toBe(false)
	})

	it("provisions webhook config on first send and persists it back to settings", async () => {
		const previousSettings = DISCORD_WEBHOOK_EMPTY_SETTINGS
		let updatedSettings: Record<string, unknown> | null = null
		const originalToken = process.env.DISCORD_BOT_TOKEN
		process.env.DISCORD_BOT_TOKEN = "unit-test-token"

		try {
			let persistedLinkId: string | undefined
			const layer = makeWorkerLayerWithOverrides({
				connectionRepo: {
					findById: () =>
						Effect.succeed(
							Option.some({
								id: SYNC_CONNECTION_ID,
								organizationId: ORGANIZATION_ID,
								provider: "discord",
								status: "active",
							}),
						),
					updateLastSyncedAt: () => Effect.succeed([]),
				} as unknown as ChatSyncConnectionRepo,
				channelLinkRepo: {
					findByHazelChannel: () =>
						Effect.succeed(
							Option.some({
								id: CHANNEL_LINK_ID,
								externalChannelId: DISCORD_CHANNEL_ID,
								hazelChannelId: HAZEL_CHANNEL_ID,
								settings: previousSettings,
							}),
						),
					updateLastSyncedAt: () => Effect.succeed([]),
					updateSettings: (id: SyncChannelLinkId, settings: Record<string, unknown> | null) => {
						persistedLinkId = id
						updatedSettings = settings
						return Effect.succeed([{ id }])
					},
				} as unknown as ChatSyncChannelLinkRepo,
				messageLinkRepo: {
					findByHazelMessage: () => Effect.succeed(Option.none()),
					insert: () => Effect.succeed([{ id: "message-link-id" }]),
				} as unknown as ChatSyncMessageLinkRepo,
				eventReceiptRepo: {
					claimByDedupeKey: () => Effect.succeed(true),
					updateByDedupeKey: () => Effect.succeed([]),
				} as unknown as ChatSyncEventReceiptRepo,
				messageRepo: {
					findById: () =>
						Effect.succeed(
							Option.some({
								id: HAZEL_MESSAGE_ID,
								channelId: HAZEL_CHANNEL_ID,
								authorId: BOT_USER_ID,
								content: "hello from hazel",
								replyToMessageId: null,
								threadChannelId: null,
							}),
						),
				} as unknown as MessageRepo,
				messageReactionRepo: {} as unknown as MessageReactionRepo,
				channelRepo: {} as unknown as ChannelRepo,
				integrationConnectionRepo: {} as unknown as IntegrationConnectionRepo,
				userRepo: {
					findById: () =>
						Effect.succeed(
							Option.some({
								id: BOT_USER_ID,
								firstName: "Alex",
								lastName: "Doe",
								avatarUrl: "https://avatar.example/discord",
							}),
						),
				} as unknown as UserRepo,
				organizationMemberRepo: {} as unknown as OrganizationMemberRepo,
				integrationBotService: {
					getOrCreateBotUser: () => Effect.succeed({ id: BOT_USER_ID }),
				} as unknown as IntegrationBotService,
				channelAccessSyncService: {} as unknown as ChannelAccessSyncService,
				providerRegistry: {
					getAdapter: () =>
						Effect.succeed({
							provider: "discord",
							createMessage: () =>
								Effect.fail(new Error("should not call bot API create message")),
							updateMessage: () =>
								Effect.fail(new Error("should not call bot API update message")),
							deleteMessage: () =>
								Effect.fail(new Error("should not call bot API delete message")),
							addReaction: () => Effect.succeed(undefined),
							removeReaction: () => Effect.succeed(undefined),
							createThread: () => Effect.succeed("thread-id"),
						}),
				} as unknown as ChatSyncProviderRegistry,
				discordApiClient: {
					createWebhook: () =>
						Effect.succeed({
							webhookId: DISCORD_WEBHOOK_ID,
							webhookToken: DISCORD_WEBHOOK_TOKEN,
						}),
					executeWebhookMessage: ({ webhookId }: { webhookId: string }) => {
						expect(webhookId).toBe(DISCORD_WEBHOOK_ID)
						return Effect.succeed(DISCORD_WEBHOOK_MESSAGE_ID)
					},
					updateWebhookMessage: () => Effect.succeed(undefined),
					deleteWebhookMessage: () => Effect.succeed(undefined),
				} as unknown as Discord.DiscordApiClient,
			})

			const result = await runWorkerEffect(
				DiscordSyncWorker.syncHazelMessageToDiscord(SYNC_CONNECTION_ID, HAZEL_MESSAGE_ID).pipe(
					Effect.provide(layer),
				),
			)

			expect(result.status).toBe("synced")
			expect(result.externalMessageId).toBe(DISCORD_WEBHOOK_MESSAGE_ID)
			expect(persistedLinkId).toBe(CHANNEL_LINK_ID)
			const outboundIdentitySettings = (
				updatedSettings as
					| {
							outboundIdentity: {
								providers: {
									discord: { webhookId: string; webhookToken: string; kind: string }
								}
							}
					  }
					| undefined
					| null
			)?.outboundIdentity
			expect(outboundIdentitySettings).toBeDefined()
			expect(outboundIdentitySettings?.providers?.discord?.kind).toBe("discord.webhook")
			expect(outboundIdentitySettings?.providers?.discord?.webhookId).toBe(DISCORD_WEBHOOK_ID)
			expect(outboundIdentitySettings?.providers?.discord?.webhookToken).toBe(DISCORD_WEBHOOK_TOKEN)
		} finally {
			if (originalToken === undefined) {
				delete process.env.DISCORD_BOT_TOKEN
			} else {
				process.env.DISCORD_BOT_TOKEN = originalToken
			}
		}
	})

	it("skips webhook provisioning when permission is denied in settings", async () => {
		const originalToken = process.env.DISCORD_BOT_TOKEN
		process.env.DISCORD_BOT_TOKEN = "unit-test-token"
		let createWebhookCalled = false
		let botApiCalled = false
		try {
			const layer = makeWorkerLayerWithOverrides({
				connectionRepo: {
					findById: () =>
						Effect.succeed(
							Option.some({
								id: SYNC_CONNECTION_ID,
								organizationId: ORGANIZATION_ID,
								provider: "discord",
								status: "active",
							}),
						),
					updateLastSyncedAt: () => Effect.succeed([]),
				},
				channelLinkRepo: {
					findByHazelChannel: () =>
						Effect.succeed(
							Option.some({
								id: CHANNEL_LINK_ID,
								externalChannelId: DISCORD_CHANNEL_ID_SNOWFLAKE,
								hazelChannelId: HAZEL_CHANNEL_ID,
								settings: DISCORD_WEBHOOK_DENIED_PERMISSION_SETTINGS,
							}),
						),
					updateLastSyncedAt: () => Effect.succeed([]),
					updateSettings: () => {
						return Effect.succeed([{ id: CHANNEL_LINK_ID }])
					},
				} as unknown as ChatSyncChannelLinkRepo,
				messageLinkRepo: {
					findByHazelMessage: () => Effect.succeed(Option.none()),
					insert: () => Effect.succeed([{ id: "message-link-id" }]),
				} as unknown as ChatSyncMessageLinkRepo,
				eventReceiptRepo: {
					claimByDedupeKey: () => Effect.succeed(true),
					updateByDedupeKey: () => Effect.succeed([]),
				} as unknown as ChatSyncEventReceiptRepo,
				messageRepo: {
					findById: () =>
						Effect.succeed(
							Option.some({
								id: HAZEL_MESSAGE_ID,
								channelId: HAZEL_CHANNEL_ID,
								authorId: BOT_USER_ID,
								content: "hello from hazel",
								replyToMessageId: null,
								threadChannelId: null,
							}),
						),
				} as unknown as MessageRepo,
				messageReactionRepo: {} as unknown as MessageReactionRepo,
				channelRepo: {} as unknown as ChannelRepo,
				integrationConnectionRepo: {} as unknown as IntegrationConnectionRepo,
				userRepo: {
					findById: () =>
						Effect.succeed(
							Option.some({
								id: BOT_USER_ID,
								firstName: "Alex",
								lastName: "Doe",
								avatarUrl: "https://avatar.example/discord",
							}),
						),
				} as unknown as UserRepo,
				organizationMemberRepo: {} as unknown as OrganizationMemberRepo,
				integrationBotService: {
					getOrCreateBotUser: () => Effect.succeed({ id: BOT_USER_ID }),
				} as unknown as IntegrationBotService,
				channelAccessSyncService: {} as unknown as ChannelAccessSyncService,
				providerRegistry: {
					getAdapter: () =>
						Effect.succeed({
							provider: "discord",
							createMessage: () => {
								botApiCalled = true
								return Effect.succeed("bot-message-id")
							},
							updateMessage: () => Effect.succeed(undefined),
							deleteMessage: () => Effect.succeed(undefined),
							addReaction: () => Effect.succeed(undefined),
							removeReaction: () => Effect.succeed(undefined),
							createThread: () => Effect.succeed("thread-id"),
						}),
				} as unknown as ChatSyncProviderRegistry,
				discordApiClient: {
					createMessage: () => {
						botApiCalled = true
						return Effect.succeed("bot-message-id")
					},
					createWebhook: () => {
						createWebhookCalled = true
						return Effect.fail(new Error("should not create webhook when denied"))
					},
					executeWebhookMessage: () => Effect.fail(new Error("should not execute webhook")),
					updateWebhookMessage: () => Effect.succeed(undefined),
					deleteWebhookMessage: () => Effect.succeed(undefined),
				} as unknown as Discord.DiscordApiClient,
			})

			const result = await runWorkerEffect(
				DiscordSyncWorker.syncHazelMessageToDiscord(SYNC_CONNECTION_ID, HAZEL_MESSAGE_ID).pipe(
					Effect.provide(layer),
				),
			)

			expect(result.status).toBe("synced")
			expect(result.externalMessageId).toBe("bot-message-id")
			expect(createWebhookCalled).toBe(false)
			expect(botApiCalled).toBe(true)
		} finally {
			if (originalToken === undefined) {
				delete process.env.DISCORD_BOT_TOKEN
			} else {
				process.env.DISCORD_BOT_TOKEN = originalToken
			}
		}
	})

	it("marks webhook permission as denied and falls back when Discord returns 403", async () => {
		const originalToken = process.env.DISCORD_BOT_TOKEN
		process.env.DISCORD_BOT_TOKEN = "unit-test-token"
		let webhookProvisioned = false
		let adapterCreateCalled = false
		let updatedSettings: Record<string, unknown> | null = null
		const checkedReason = "Webhook create forbidden (HTTP 403)"

		try {
			const layer = makeWorkerLayerWithOverrides({
				connectionRepo: {
					findById: () =>
						Effect.succeed(
							Option.some({
								id: SYNC_CONNECTION_ID,
								organizationId: ORGANIZATION_ID,
								provider: "discord",
								status: "active",
							}),
						),
					updateLastSyncedAt: () => Effect.succeed([]),
				} as unknown as ChatSyncConnectionRepo,
				channelLinkRepo: {
					findByHazelChannel: () =>
						Effect.succeed(
							Option.some({
								id: CHANNEL_LINK_ID,
								externalChannelId: DISCORD_CHANNEL_ID_SNOWFLAKE,
								hazelChannelId: HAZEL_CHANNEL_ID,
								settings: DISCORD_WEBHOOK_EMPTY_SETTINGS,
							}),
						),
					updateLastSyncedAt: () => Effect.succeed([]),
					updateSettings: (id: SyncChannelLinkId, settings: Record<string, unknown> | null) => {
						updatedSettings = settings
						return Effect.succeed([{ id }])
					},
				} as unknown as ChatSyncChannelLinkRepo,
				messageLinkRepo: {
					findByHazelMessage: () => Effect.succeed(Option.none()),
					insert: () => Effect.succeed([{ id: "message-link-id" }]),
				} as unknown as ChatSyncMessageLinkRepo,
				eventReceiptRepo: {
					claimByDedupeKey: () => Effect.succeed(true),
					updateByDedupeKey: () => Effect.succeed([]),
				} as unknown as ChatSyncEventReceiptRepo,
				messageRepo: {
					findById: () =>
						Effect.succeed(
							Option.some({
								id: HAZEL_MESSAGE_ID,
								channelId: HAZEL_CHANNEL_ID,
								authorId: BOT_USER_ID,
								content: "hello from hazel",
								replyToMessageId: null,
								threadChannelId: null,
							}),
						),
				} as unknown as MessageRepo,
				messageReactionRepo: {} as unknown as MessageReactionRepo,
				channelRepo: {} as unknown as ChannelRepo,
				integrationConnectionRepo: {} as unknown as IntegrationConnectionRepo,
				userRepo: {
					findById: () =>
						Effect.succeed(
							Option.some({
								id: BOT_USER_ID,
								firstName: "Alex",
								lastName: "Doe",
								avatarUrl: "https://avatar.example/discord",
							}),
						),
				} as unknown as UserRepo,
				organizationMemberRepo: {} as unknown as OrganizationMemberRepo,
				integrationBotService: {
					getOrCreateBotUser: () => Effect.succeed({ id: BOT_USER_ID }),
				} as unknown as IntegrationBotService,
				channelAccessSyncService: {} as unknown as ChannelAccessSyncService,
				providerRegistry: {
					getAdapter: () =>
						Effect.succeed({
							provider: "discord",
							createMessage: () => {
								adapterCreateCalled = true
								return Effect.succeed("bot-message-id")
							},
							updateMessage: () => Effect.succeed(undefined),
							deleteMessage: () => Effect.succeed(undefined),
							addReaction: () => Effect.succeed(undefined),
							removeReaction: () => Effect.succeed(undefined),
							createThread: () => Effect.succeed("thread-id"),
						}),
				} as unknown as ChatSyncProviderRegistry,
				discordApiClient: {
					createMessage: () => {
						adapterCreateCalled = true
						return Effect.succeed("bot-message-id")
					},
					createWebhook: () => {
						webhookProvisioned = true
						return Effect.fail(
							new Discord.DiscordApiError({
								message: checkedReason,
								status: 403,
							}),
						)
					},
					executeWebhookMessage: () => Effect.fail(new Error("should not be called")),
					updateWebhookMessage: () => Effect.succeed(undefined),
					deleteWebhookMessage: () => Effect.succeed(undefined),
				} as unknown as Discord.DiscordApiClient,
			})

			const result = await runWorkerEffect(
				DiscordSyncWorker.syncHazelMessageToDiscord(SYNC_CONNECTION_ID, HAZEL_MESSAGE_ID).pipe(
					Effect.provide(layer),
				),
			)

			expect(result.status).toBe("synced")
			expect(result.externalMessageId).toBe("bot-message-id")
			expect(webhookProvisioned).toBe(true)
			expect(adapterCreateCalled).toBe(true)
			const webhookState = (
				updatedSettings as
					| {
							outboundIdentity?: { strategy?: string }
							webhookPermission?: { status?: string; checkedAt?: string; reason?: string }
					  }
					| null
					| undefined
			)?.webhookPermission
			const outboundIdentity = (
				updatedSettings as { outboundIdentity?: { strategy?: string } } | null | undefined
			)?.outboundIdentity
			expect(outboundIdentity?.strategy).toBe("fallback_bot")
			expect(webhookState?.status).toBe("denied")
			expect(webhookState?.reason).toContain("403")
			expect(typeof webhookState?.checkedAt).toBe("string")
			expect(adapterCreateCalled).toBe(true)
			expect(webhookProvisioned).toBe(true)
		} finally {
			if (originalToken === undefined) {
				delete process.env.DISCORD_BOT_TOKEN
			} else {
				process.env.DISCORD_BOT_TOKEN = originalToken
			}
		}
	})

	it("falls back to bot API when webhook provisioning fails for non-403 errors", async () => {
		const originalToken = process.env.DISCORD_BOT_TOKEN
		process.env.DISCORD_BOT_TOKEN = "unit-test-token"
		let webhookProvisioned = false
		let adapterCreateCalled = false
		let updatedSettings: Record<string, unknown> | null = null

		try {
			const layer = makeWorkerLayerWithOverrides({
				connectionRepo: {
					findById: () =>
						Effect.succeed(
							Option.some({
								id: SYNC_CONNECTION_ID,
								organizationId: ORGANIZATION_ID,
								provider: "discord",
								status: "active",
							}),
						),
					updateLastSyncedAt: () => Effect.succeed([]),
				} as unknown as ChatSyncConnectionRepo,
				channelLinkRepo: {
					findByHazelChannel: () =>
						Effect.succeed(
							Option.some({
								id: CHANNEL_LINK_ID,
								externalChannelId: DISCORD_CHANNEL_ID_SNOWFLAKE,
								hazelChannelId: HAZEL_CHANNEL_ID,
								settings: DISCORD_WEBHOOK_EMPTY_SETTINGS,
							}),
						),
					updateLastSyncedAt: () => Effect.succeed([]),
					updateSettings: (id: SyncChannelLinkId, settings: Record<string, unknown> | null) => {
						updatedSettings = settings
						return Effect.succeed([{ id }])
					},
				} as unknown as ChatSyncChannelLinkRepo,
				messageLinkRepo: {
					findByHazelMessage: () => Effect.succeed(Option.none()),
					insert: () => Effect.succeed([{ id: "message-link-id" }]),
				} as unknown as ChatSyncMessageLinkRepo,
				eventReceiptRepo: {
					claimByDedupeKey: () => Effect.succeed(true),
					updateByDedupeKey: () => Effect.succeed([]),
				} as unknown as ChatSyncEventReceiptRepo,
				messageRepo: {
					findById: () =>
						Effect.succeed(
							Option.some({
								id: HAZEL_MESSAGE_ID,
								channelId: HAZEL_CHANNEL_ID,
								authorId: BOT_USER_ID,
								content: "hello from hazel",
								replyToMessageId: null,
								threadChannelId: null,
							}),
						),
				} as unknown as MessageRepo,
				messageReactionRepo: {} as unknown as MessageReactionRepo,
				channelRepo: {} as unknown as ChannelRepo,
				integrationConnectionRepo: {} as unknown as IntegrationConnectionRepo,
				userRepo: {
					findById: () =>
						Effect.succeed(
							Option.some({
								id: BOT_USER_ID,
								firstName: "Alex",
								lastName: "Doe",
								avatarUrl: "https://avatar.example/discord",
							}),
						),
				} as unknown as UserRepo,
				organizationMemberRepo: {} as unknown as OrganizationMemberRepo,
				integrationBotService: {
					getOrCreateBotUser: () => Effect.succeed({ id: BOT_USER_ID }),
				} as unknown as IntegrationBotService,
				channelAccessSyncService: {} as unknown as ChannelAccessSyncService,
				providerRegistry: {
					getAdapter: () =>
						Effect.succeed({
							provider: "discord",
							createMessage: () => {
								adapterCreateCalled = true
								return Effect.succeed("bot-message-id")
							},
							updateMessage: () => Effect.succeed(undefined),
							deleteMessage: () => Effect.succeed(undefined),
							addReaction: () => Effect.succeed(undefined),
							removeReaction: () => Effect.succeed(undefined),
							createThread: () => Effect.succeed("thread-id"),
						}),
				} as unknown as ChatSyncProviderRegistry,
				discordApiClient: {
					createMessage: () => {
						adapterCreateCalled = true
						return Effect.succeed("bot-message-id")
					},
					createWebhook: () => {
						webhookProvisioned = true
						return Effect.fail(
							new Discord.DiscordApiError({
								message: "webhook provisioning failed",
								status: 500,
							}),
						)
					},
					executeWebhookMessage: () => Effect.fail(new Error("should not be called")),
					updateWebhookMessage: () => Effect.succeed(undefined),
					deleteWebhookMessage: () => Effect.succeed(undefined),
				} as unknown as Discord.DiscordApiClient,
			})

			const result = await runWorkerEffect(
				DiscordSyncWorker.syncHazelMessageToDiscord(SYNC_CONNECTION_ID, HAZEL_MESSAGE_ID).pipe(
					Effect.provide(layer),
				),
			)

			expect(result.status).toBe("synced")
			expect(result.externalMessageId).toBe("bot-message-id")
			expect(webhookProvisioned).toBe(true)
			expect(adapterCreateCalled).toBe(true)
			const webhookState = (
				updatedSettings as
					| {
							outboundIdentity?: { strategy?: string }
							webhookPermission?: { status?: string; checkedAt?: string; reason?: string }
					  }
					| null
					| undefined
			)?.webhookPermission
			const outboundIdentity = (
				updatedSettings as { outboundIdentity?: { strategy?: string } } | null | undefined
			)?.outboundIdentity
			expect(outboundIdentity?.strategy).toBe("webhook")
			expect(webhookState?.status).toBe("unknown")
			expect(typeof webhookState?.checkedAt).toBe("string")
		} finally {
			if (originalToken === undefined) {
				delete process.env.DISCORD_BOT_TOKEN
			} else {
				process.env.DISCORD_BOT_TOKEN = originalToken
			}
		}
	})
})

describe("DiscordSyncWorker outbound attachments primitive", () => {
	it("uses createMessageWithAttachments when message has completed attachments", async () => {
		let createMessageCalled = false
		let createMessageWithAttachmentsCalled = false
		let receivedAttachmentCount = 0

		const layer = makeWorkerLayerWithOverrides({
			connectionRepo: {
				findById: () =>
					Effect.succeed(
						Option.some({
							id: SYNC_CONNECTION_ID,
							organizationId: ORGANIZATION_ID,
							provider: "discord",
							status: "active",
						}),
					),
				updateLastSyncedAt: () => Effect.succeed([]),
			} as unknown as ChatSyncConnectionRepo,
			channelLinkRepo: {
				findByHazelChannel: () =>
					Effect.succeed(
						Option.some({
							id: CHANNEL_LINK_ID,
							externalChannelId: DISCORD_CHANNEL_ID,
							hazelChannelId: HAZEL_CHANNEL_ID,
							settings: null,
						}),
					),
				updateLastSyncedAt: () => Effect.succeed([]),
			} as unknown as ChatSyncChannelLinkRepo,
			messageLinkRepo: {
				findByHazelMessage: () => Effect.succeed(Option.none()),
				insert: () =>
					Effect.succeed([
						{
							id: "message-link-id",
							channelLinkId: CHANNEL_LINK_ID,
							externalMessageId: DISCORD_MESSAGE_ID,
						} as any,
					]),
			} as unknown as ChatSyncMessageLinkRepo,
			eventReceiptRepo: {
				claimByDedupeKey: () => Effect.succeed(true),
				updateByDedupeKey: () => Effect.succeed([]),
			} as unknown as ChatSyncEventReceiptRepo,
			messageRepo: {
				findById: () =>
					Effect.succeed(
						Option.some({
							id: HAZEL_MESSAGE_ID,
							channelId: HAZEL_CHANNEL_ID,
							authorId: BOT_USER_ID,
							content: "attachment message",
							replyToMessageId: null,
							threadChannelId: null,
						}),
					),
			} as unknown as MessageRepo,
			messageReactionRepo: {} as unknown as MessageReactionRepo,
			channelRepo: {} as unknown as ChannelRepo,
			integrationConnectionRepo: {} as unknown as IntegrationConnectionRepo,
			userRepo: {
				findById: () => Effect.succeed(Option.none()),
			} as unknown as UserRepo,
			organizationMemberRepo: {} as unknown as OrganizationMemberRepo,
			integrationBotService: {
				getOrCreateBotUser: () => Effect.succeed({ id: BOT_USER_ID }),
			} as unknown as IntegrationBotService,
			channelAccessSyncService: {} as unknown as ChannelAccessSyncService,
			providerRegistry: {
				getAdapter: () =>
					Effect.succeed({
						provider: "discord",
						createMessage: () => {
							createMessageCalled = true
							return Effect.succeed(DISCORD_MESSAGE_ID)
						},
						createMessageWithAttachments: ({
							attachments,
						}: {
							attachments: ReadonlyArray<unknown>
						}) => {
							createMessageWithAttachmentsCalled = true
							receivedAttachmentCount = attachments.length
							return Effect.succeed(DISCORD_MESSAGE_ID)
						},
						updateMessage: () => Effect.succeed(undefined),
						deleteMessage: () => Effect.succeed(undefined),
						addReaction: () => Effect.succeed(undefined),
						removeReaction: () => Effect.succeed(undefined),
						createThread: () => Effect.succeed("thread-id"),
					}),
			} as unknown as ChatSyncProviderRegistry,
			databaseRun: () =>
				Effect.succeed([
					{
						id: "00000000-0000-4000-8000-000000000101",
						fileName: "diagram.png",
						fileSize: 2048,
					},
				]),
		})

		const result = await runWorkerEffect(
			DiscordSyncWorker.syncHazelMessageToDiscord(SYNC_CONNECTION_ID, HAZEL_MESSAGE_ID).pipe(
				Effect.provide(layer),
				Effect.provide(configLayer({ S3_PUBLIC_URL: ATTACHMENT_PUBLIC_URL })),
			),
		)

		expect(result.status).toBe("synced")
		expect(createMessageWithAttachmentsCalled).toBe(true)
		expect(createMessageCalled).toBe(false)
		expect(receivedAttachmentCount).toBe(1)
	})

	it("keeps using createMessage when no attachments are present", async () => {
		let createMessageCalled = false
		let createMessageWithAttachmentsCalled = false

		const layer = makeWorkerLayerWithOverrides({
			connectionRepo: {
				findById: () =>
					Effect.succeed(
						Option.some({
							id: SYNC_CONNECTION_ID,
							organizationId: ORGANIZATION_ID,
							provider: "discord",
							status: "active",
						}),
					),
				updateLastSyncedAt: () => Effect.succeed([]),
			} as unknown as ChatSyncConnectionRepo,
			channelLinkRepo: {
				findByHazelChannel: () =>
					Effect.succeed(
						Option.some({
							id: CHANNEL_LINK_ID,
							externalChannelId: DISCORD_CHANNEL_ID,
							hazelChannelId: HAZEL_CHANNEL_ID,
							settings: null,
						}),
					),
				updateLastSyncedAt: () => Effect.succeed([]),
			} as unknown as ChatSyncChannelLinkRepo,
			messageLinkRepo: {
				findByHazelMessage: () => Effect.succeed(Option.none()),
				insert: () => Effect.succeed([{ id: "message-link-id", channelLinkId: CHANNEL_LINK_ID }]),
			} as unknown as ChatSyncMessageLinkRepo,
			eventReceiptRepo: {
				claimByDedupeKey: () => Effect.succeed(true),
				updateByDedupeKey: () => Effect.succeed([]),
			} as unknown as ChatSyncEventReceiptRepo,
			messageRepo: {
				findById: () =>
					Effect.succeed(
						Option.some({
							id: HAZEL_MESSAGE_ID,
							channelId: HAZEL_CHANNEL_ID,
							authorId: BOT_USER_ID,
							content: "plain text",
							replyToMessageId: null,
							threadChannelId: null,
						}),
					),
			} as unknown as MessageRepo,
			messageReactionRepo: {} as unknown as MessageReactionRepo,
			channelRepo: {} as unknown as ChannelRepo,
			integrationConnectionRepo: {} as unknown as IntegrationConnectionRepo,
			userRepo: {} as unknown as UserRepo,
			organizationMemberRepo: {} as unknown as OrganizationMemberRepo,
			integrationBotService: {
				getOrCreateBotUser: () => Effect.succeed({ id: BOT_USER_ID }),
			} as unknown as IntegrationBotService,
			channelAccessSyncService: {} as unknown as ChannelAccessSyncService,
			providerRegistry: {
				getAdapter: () =>
					Effect.succeed({
						provider: "discord",
						createMessage: () => {
							createMessageCalled = true
							return Effect.succeed(DISCORD_MESSAGE_ID)
						},
						createMessageWithAttachments: () => {
							createMessageWithAttachmentsCalled = true
							return Effect.succeed(DISCORD_MESSAGE_ID)
						},
						updateMessage: () => Effect.succeed(undefined),
						deleteMessage: () => Effect.succeed(undefined),
						addReaction: () => Effect.succeed(undefined),
						removeReaction: () => Effect.succeed(undefined),
						createThread: () => Effect.succeed("thread-id"),
					}),
			} as unknown as ChatSyncProviderRegistry,
			databaseRun: () => Effect.succeed([]),
		})

		const result = await runWorkerEffect(
			DiscordSyncWorker.syncHazelMessageToDiscord(SYNC_CONNECTION_ID, HAZEL_MESSAGE_ID).pipe(
				Effect.provide(layer),
			),
		)

		expect(result.status).toBe("synced")
		expect(createMessageCalled).toBe(true)
		expect(createMessageWithAttachmentsCalled).toBe(false)
	})

	it("falls back to attachment primitive when webhook send fails in webhook mode", async () => {
		let createMessageWithAttachmentsCalled = false
		let firstAttachmentUrl: string | null = null

		const layer = makeWorkerLayerWithOverrides({
			connectionRepo: {
				findById: () =>
					Effect.succeed(
						Option.some({
							id: SYNC_CONNECTION_ID,
							organizationId: ORGANIZATION_ID,
							provider: "discord",
							status: "active",
						}),
					),
				updateLastSyncedAt: () => Effect.succeed([]),
			} as unknown as ChatSyncConnectionRepo,
			channelLinkRepo: {
				findByHazelChannel: () =>
					Effect.succeed(
						Option.some({
							id: CHANNEL_LINK_ID,
							externalChannelId: DISCORD_CHANNEL_ID,
							hazelChannelId: HAZEL_CHANNEL_ID,
							settings: DISCORD_WEBHOOK_IDENTITY_SETTINGS,
						}),
					),
				updateLastSyncedAt: () => Effect.succeed([]),
			} as unknown as ChatSyncChannelLinkRepo,
			messageLinkRepo: {
				findByHazelMessage: () => Effect.succeed(Option.none()),
				insert: () =>
					Effect.succeed([
						{
							id: "message-link-id",
							channelLinkId: CHANNEL_LINK_ID,
							externalMessageId: DISCORD_WEBHOOK_MESSAGE_ID,
						} as any,
					]),
			} as unknown as ChatSyncMessageLinkRepo,
			eventReceiptRepo: {
				claimByDedupeKey: () => Effect.succeed(true),
				updateByDedupeKey: () => Effect.succeed([]),
			} as unknown as ChatSyncEventReceiptRepo,
			messageRepo: {
				findById: () =>
					Effect.succeed(
						Option.some({
							id: HAZEL_MESSAGE_ID,
							channelId: HAZEL_CHANNEL_ID,
							authorId: BOT_USER_ID,
							content: "with attachments",
							replyToMessageId: null,
							threadChannelId: null,
						}),
					),
			} as unknown as MessageRepo,
			messageReactionRepo: {} as unknown as MessageReactionRepo,
			channelRepo: {} as unknown as ChannelRepo,
			integrationConnectionRepo: {} as unknown as IntegrationConnectionRepo,
			userRepo: {
				findById: () =>
					Effect.succeed(
						Option.some({
							id: BOT_USER_ID,
							firstName: "Alex",
							lastName: "Doe",
							avatarUrl: "",
						}),
					),
			} as unknown as UserRepo,
			organizationMemberRepo: {} as unknown as OrganizationMemberRepo,
			integrationBotService: {
				getOrCreateBotUser: () => Effect.succeed({ id: BOT_USER_ID }),
			} as unknown as IntegrationBotService,
			channelAccessSyncService: {} as unknown as ChannelAccessSyncService,
			providerRegistry: {
				getAdapter: () =>
					Effect.succeed({
						provider: "discord",
						createMessage: () => Effect.fail(new Error("should not hit createMessage")),
						createMessageWithAttachments: ({
							attachments,
						}: {
							attachments: ReadonlyArray<{ publicUrl: string }>
						}) => {
							createMessageWithAttachmentsCalled = true
							firstAttachmentUrl = attachments[0]?.publicUrl ?? null
							return Effect.succeed(DISCORD_WEBHOOK_MESSAGE_ID)
						},
						updateMessage: () => Effect.succeed(undefined),
						deleteMessage: () => Effect.succeed(undefined),
						addReaction: () => Effect.succeed(undefined),
						removeReaction: () => Effect.succeed(undefined),
						createThread: () => Effect.succeed("thread-id"),
					}),
			} as unknown as ChatSyncProviderRegistry,
			discordApiClient: {
				executeWebhookMessage: () =>
					Effect.fail(new Discord.DiscordApiError({ message: "webhook send failed", status: 500 })),
				createWebhook: () => Effect.fail(new Error("not expected")),
				updateWebhookMessage: () => Effect.succeed(undefined),
				deleteWebhookMessage: () => Effect.succeed(undefined),
			} as unknown as Discord.DiscordApiClient,
			databaseRun: () =>
				Effect.succeed([
					{
						id: "00000000-0000-4000-8000-000000000201",
						fileName: "capture.jpg",
						fileSize: 5120,
					},
				]),
		})

		const result = await runWorkerEffect(
			DiscordSyncWorker.syncHazelMessageToDiscord(SYNC_CONNECTION_ID, HAZEL_MESSAGE_ID).pipe(
				Effect.provide(layer),
				Effect.provide(configLayer({ S3_PUBLIC_URL: ATTACHMENT_PUBLIC_URL })),
			),
		)

		expect(result.status).toBe("synced")
		expect(createMessageWithAttachmentsCalled).toBe(true)
		expect(firstAttachmentUrl).toBe(`${ATTACHMENT_PUBLIC_URL}/00000000-0000-4000-8000-000000000201`)
	})

	it("fails with configuration error when attachments exist and S3_PUBLIC_URL is missing", async () => {
		const layer = makeWorkerLayerWithOverrides({
			connectionRepo: {
				findById: () =>
					Effect.succeed(
						Option.some({
							id: SYNC_CONNECTION_ID,
							organizationId: ORGANIZATION_ID,
							provider: "discord",
							status: "active",
						}),
					),
			} as unknown as ChatSyncConnectionRepo,
			channelLinkRepo: {
				findByHazelChannel: () =>
					Effect.succeed(
						Option.some({
							id: CHANNEL_LINK_ID,
							externalChannelId: DISCORD_CHANNEL_ID,
							hazelChannelId: HAZEL_CHANNEL_ID,
							settings: null,
						}),
					),
			} as unknown as ChatSyncChannelLinkRepo,
			messageLinkRepo: {
				findByHazelMessage: () => Effect.succeed(Option.none()),
			} as unknown as ChatSyncMessageLinkRepo,
			eventReceiptRepo: {
				claimByDedupeKey: () => Effect.succeed(true),
				updateByDedupeKey: () => Effect.succeed([]),
			} as unknown as ChatSyncEventReceiptRepo,
			messageRepo: {
				findById: () =>
					Effect.succeed(
						Option.some({
							id: HAZEL_MESSAGE_ID,
							channelId: HAZEL_CHANNEL_ID,
							authorId: BOT_USER_ID,
							content: "missing env",
							replyToMessageId: null,
							threadChannelId: null,
						}),
					),
			} as unknown as MessageRepo,
			messageReactionRepo: {} as unknown as MessageReactionRepo,
			channelRepo: {} as unknown as ChannelRepo,
			integrationConnectionRepo: {} as unknown as IntegrationConnectionRepo,
			userRepo: {} as unknown as UserRepo,
			organizationMemberRepo: {} as unknown as OrganizationMemberRepo,
			integrationBotService: {
				getOrCreateBotUser: () => Effect.succeed({ id: BOT_USER_ID }),
			} as unknown as IntegrationBotService,
			channelAccessSyncService: {} as unknown as ChannelAccessSyncService,
			providerRegistry: {
				getAdapter: () =>
					Effect.succeed({
						provider: "discord",
						createMessage: () => Effect.succeed(DISCORD_MESSAGE_ID),
						createMessageWithAttachments: () => Effect.succeed(DISCORD_MESSAGE_ID),
						updateMessage: () => Effect.succeed(undefined),
						deleteMessage: () => Effect.succeed(undefined),
						addReaction: () => Effect.succeed(undefined),
						removeReaction: () => Effect.succeed(undefined),
						createThread: () => Effect.succeed("thread-id"),
					}),
			} as unknown as ChatSyncProviderRegistry,
			databaseRun: () =>
				Effect.succeed([
					{
						id: "00000000-0000-4000-8000-000000000301",
						fileName: "missing-env.txt",
						fileSize: 10,
					},
				]),
		})

		const originalS3PublicUrl = process.env.S3_PUBLIC_URL
		delete process.env.S3_PUBLIC_URL
		try {
			const result = await runWorkerEffect(
				DiscordSyncWorker.syncHazelMessageToDiscord(SYNC_CONNECTION_ID, HAZEL_MESSAGE_ID).pipe(
					Effect.provide(layer),
					Effect.result,
				),
			)

			expect(result._tag).toBe("Failure")
			if (result._tag === "Failure") {
				expect((result.failure as { _tag?: string })._tag).toBe("DiscordSyncConfigurationError")
			}
		} finally {
			if (originalS3PublicUrl === undefined) {
				delete process.env.S3_PUBLIC_URL
			} else {
				process.env.S3_PUBLIC_URL = originalS3PublicUrl
			}
		}
	})
})
