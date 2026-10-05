import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http"
import { randomUUID } from "node:crypto"
import { Database, schema } from "@hazel/db"
import type { ChannelId, MessageId, MessageReactionId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Layer, Context } from "effect"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createChatSyncDbHarness, type ChatSyncDbHarness } from "../test/chat-sync-db-harness"
import { configLayer, serviceShape } from "../test/effect-helpers"
import { DiscordSyncWorker } from "./chat-sync/discord-sync-worker"
import { MessageSideEffectService } from "./message-side-effect-service"

const CLUSTER_URL = "http://cluster.test"
const ORG_ID = "00000000-0000-4000-8000-000000000001" as OrganizationId
const CHANNEL_ID = "00000000-0000-4000-8000-000000000002" as ChannelId
const THREAD_CHANNEL_ID = "00000000-0000-4000-8000-000000000003" as ChannelId
const AUTHOR_ID = "00000000-0000-4000-8000-000000000004" as UserId
const INTEGRATION_BOT_ID = "00000000-0000-4000-8000-000000000005" as UserId
const ORIGINAL_MESSAGE_ID = "00000000-0000-4000-8000-000000000006" as MessageId
const EXISTING_THREAD_MESSAGE_IDS = [
	"00000000-0000-4000-8000-000000000007" as MessageId,
	"00000000-0000-4000-8000-000000000008" as MessageId,
	"00000000-0000-4000-8000-000000000009" as MessageId,
] as const satisfies ReadonlyArray<MessageId>
const NEW_THREAD_MESSAGE_ID = "00000000-0000-4000-8000-000000000010" as MessageId

type DiscordCall =
	| { method: "message_create"; id: string; dedupeKey?: string }
	| { method: "message_update"; id: string; dedupeKey?: string }
	| { method: "message_delete"; id: string; dedupeKey?: string }
	| { method: "reaction_create"; id: string; dedupeKey?: string }
	| { method: "reaction_delete"; payload: Record<string, unknown>; dedupeKey?: string }

type WorkerOptions = {
	failCreate?: boolean
}

const runServiceEffect = <A, E, R>(
	harness: ChatSyncDbHarness,
	worker: Context.Service.Shape<typeof DiscordSyncWorker>,
	make: Effect.Effect<A, E, R>,
	httpClientLayer: Layer.Layer<HttpClient.HttpClient> = FetchHttpClient.layer,
) =>
	Effect.runPromise(
		Effect.scoped(
			make.pipe(
				Effect.provide(Layer.effect(MessageSideEffectService, MessageSideEffectService.make)),
				Effect.provide(Layer.succeed(DiscordSyncWorker, worker)),
				Effect.provide(configLayer({ CLUSTER_URL })),
				Effect.provide(httpClientLayer),
				Effect.provide(harness.dbLayer),
			),
		) as Effect.Effect<A, E, never>,
	)

const makeDiscordWorker = (calls: DiscordCall[], options: WorkerOptions = {}) =>
	serviceShape<typeof DiscordSyncWorker>({
		syncHazelMessageCreateToAllConnections: (messageId: string, dedupeKey?: string) =>
			options.failCreate
				? Effect.fail(new Error("discord create failed"))
				: Effect.sync(() => {
						calls.push({ method: "message_create", id: messageId, dedupeKey })
						return { synced: 1, failed: 0 }
					}),
		syncHazelMessageUpdateToAllConnections: (messageId: string, dedupeKey?: string) =>
			Effect.sync(() => {
				calls.push({ method: "message_update", id: messageId, dedupeKey })
				return { synced: 1, failed: 0 }
			}),
		syncHazelMessageDeleteToAllConnections: (messageId: string, dedupeKey?: string) =>
			Effect.sync(() => {
				calls.push({ method: "message_delete", id: messageId, dedupeKey })
				return { synced: 1, failed: 0 }
			}),
		syncHazelReactionCreateToAllConnections: (reactionId: string, dedupeKey?: string) =>
			Effect.sync(() => {
				calls.push({ method: "reaction_create", id: reactionId, dedupeKey })
				return { synced: 1, failed: 0 }
			}),
		syncHazelReactionDeleteToAllConnections: (
			payload: {
				hazelChannelId: ChannelId
				hazelMessageId: MessageId
				emoji: string
				userId?: UserId
			},
			dedupeKey?: string,
		) =>
			Effect.sync(() => {
				calls.push({ method: "reaction_delete", payload, dedupeKey })
				return { synced: 1, failed: 0 }
			}),
	})

const workflowClientLayer = (requests: Array<{ url: string }>) =>
	Layer.succeed(
		HttpClient.HttpClient,
		HttpClient.make((request, url) =>
			Effect.sync(() => {
				requests.push({ url: String(url) })
				return HttpClientResponse.fromWeb(request, new Response(null, { status: 200 }))
			}),
		),
	)

const seedMessageSideEffectState = (harness: ChatSyncDbHarness) =>
	harness.run(
		Effect.gen(function* () {
			const db = yield* Database.Database

			yield* db.execute((client) =>
				client.insert(schema.organizationsTable).values({
					id: ORG_ID,
					name: "Outbox Org",
					slug: "outbox-org",
					logoUrl: null,
					settings: null,
					isPublic: false,
					deletedAt: null,
				}),
			)

			yield* db.execute((client) =>
				client.insert(schema.usersTable).values([
					{
						id: AUTHOR_ID,
						externalId: `user-${AUTHOR_ID}`,
						email: "author@example.com",
						firstName: "Author",
						lastName: "User",
						avatarUrl: null,
						userType: "user",
						settings: null,
						isOnboarded: true,
						timezone: "UTC",
						deletedAt: null,
					},
					{
						id: INTEGRATION_BOT_ID,
						externalId: "integration-bot-discord",
						email: "integration-bot@example.com",
						firstName: "Integration",
						lastName: "Bot",
						avatarUrl: null,
						userType: "machine",
						settings: null,
						isOnboarded: true,
						timezone: "UTC",
						deletedAt: null,
					},
				]),
			)

			yield* db.execute((client) =>
				client.insert(schema.channelsTable).values([
					{
						id: CHANNEL_ID,
						name: "general",
						icon: null,
						type: "public",
						organizationId: ORG_ID,
						parentChannelId: null,
						sectionId: null,
						deletedAt: null,
					},
					{
						id: THREAD_CHANNEL_ID,
						name: "Thread",
						icon: null,
						type: "thread",
						organizationId: ORG_ID,
						parentChannelId: CHANNEL_ID,
						sectionId: null,
						deletedAt: null,
					},
				]),
			)

			const messagesToInsert: Array<typeof schema.messagesTable.$inferInsert> = [
				{
					id: ORIGINAL_MESSAGE_ID,
					channelId: CHANNEL_ID,
					authorId: AUTHOR_ID,
					content: "Original message",
					replyToMessageId: null,
					threadChannelId: THREAD_CHANNEL_ID,
					deletedAt: null,
				},
				...EXISTING_THREAD_MESSAGE_IDS.map((id, index) => ({
					id,
					channelId: THREAD_CHANNEL_ID,
					authorId: AUTHOR_ID,
					content: `Existing thread message ${index + 1}`,
					replyToMessageId: null,
					threadChannelId: null,
					deletedAt: null,
				})),
				{
					id: NEW_THREAD_MESSAGE_ID,
					channelId: THREAD_CHANNEL_ID,
					authorId: AUTHOR_ID,
					content: "Newest thread message",
					replyToMessageId: null,
					threadChannelId: null,
					deletedAt: null,
				},
			]

			yield* db.execute((client) => client.insert(schema.messagesTable).values(messagesToInsert))
		}),
	)

describe("MessageSideEffectService", () => {
	let harness: ChatSyncDbHarness

	beforeAll(async () => {
		harness = await createChatSyncDbHarness()
	}, 120_000)

	beforeEach(async () => {
		await harness.reset()
		await seedMessageSideEffectState(harness)
	})

	afterAll(async () => {
		await harness.stop()
	})

	it("routes message creates through Discord sync, notifications, and thread naming", async () => {
		const calls: DiscordCall[] = []
		const requests: Array<{ url: string }> = []

		await runServiceEffect(
			harness,
			makeDiscordWorker(calls),
			Effect.gen(function* () {
				const service = yield* MessageSideEffectService
				yield* service.handleMessageCreated(
					{
						messageId: NEW_THREAD_MESSAGE_ID,
						channelId: THREAD_CHANNEL_ID,
						authorId: AUTHOR_ID,
						content: "Newest thread message",
						replyToMessageId: null,
					},
					"dedupe-1",
				)
			}),
			workflowClientLayer(requests),
		)

		expect(calls).toEqual([
			{
				method: "message_create",
				id: NEW_THREAD_MESSAGE_ID,
				dedupeKey: "dedupe-1",
			},
		])
		expect(requests.every((request) => request.url.startsWith(CLUSTER_URL))).toBe(true)

		const workflowUrls = requests.map((request) => request.url).join("\n")
		expect(workflowUrls).toContain("messagenotificationworkflow")
		expect(workflowUrls).toContain("threadnamingworkflow")
	})

	it("skips Discord loopback for the integration bot but still runs workflows", async () => {
		const calls: DiscordCall[] = []
		const requests: Array<{ url: string }> = []

		await runServiceEffect(
			harness,
			makeDiscordWorker(calls),
			Effect.gen(function* () {
				const service = yield* MessageSideEffectService
				yield* service.handleMessageCreated(
					{
						messageId: randomUUID() as MessageId,
						channelId: CHANNEL_ID,
						authorId: INTEGRATION_BOT_ID,
						content: "integration message",
						replyToMessageId: null,
					},
					"dedupe-2",
				)
			}),
			workflowClientLayer(requests),
		)

		expect(calls).toHaveLength(0)
		expect(requests).toHaveLength(1)
		expect(requests[0]?.url).toContain("messagenotificationworkflow")
	})

	it("continues to workflows when Discord create sync fails", async () => {
		const requests: Array<{ url: string }> = []

		await runServiceEffect(
			harness,
			makeDiscordWorker([], { failCreate: true }),
			Effect.gen(function* () {
				const service = yield* MessageSideEffectService
				yield* service.handleMessageCreated(
					{
						messageId: randomUUID() as MessageId,
						channelId: CHANNEL_ID,
						authorId: AUTHOR_ID,
						content: "still notifies",
						replyToMessageId: null,
					},
					"dedupe-3",
				)
			}),
			workflowClientLayer(requests),
		)

		expect(requests).toHaveLength(1)
		expect(requests[0]?.url).toContain("messagenotificationworkflow")
	})

	it("routes message updates, deletes, and reactions to the correct Discord worker methods", async () => {
		const calls: DiscordCall[] = []

		await runServiceEffect(
			harness,
			makeDiscordWorker(calls),
			Effect.gen(function* () {
				const service = yield* MessageSideEffectService
				yield* service.handleMessageUpdated(
					{
						messageId: NEW_THREAD_MESSAGE_ID,
					},
					"dedupe-update",
				)
				yield* service.handleMessageDeleted(
					{
						messageId: NEW_THREAD_MESSAGE_ID,
						channelId: THREAD_CHANNEL_ID,
					},
					"dedupe-delete",
				)
				yield* service.handleReactionCreated(
					{
						reactionId: "00000000-0000-4000-8000-000000000011" as MessageReactionId,
					},
					"dedupe-reaction-create",
				)
				yield* service.handleReactionDeleted(
					{
						hazelChannelId: THREAD_CHANNEL_ID,
						hazelMessageId: NEW_THREAD_MESSAGE_ID,
						emoji: "🔥",
						userId: AUTHOR_ID,
					},
					"dedupe-reaction-delete",
				)
			}),
		)

		expect(calls).toEqual([
			{
				method: "message_update",
				id: NEW_THREAD_MESSAGE_ID,
				dedupeKey: "dedupe-update",
			},
			{
				method: "message_delete",
				id: NEW_THREAD_MESSAGE_ID,
				dedupeKey: "dedupe-delete",
			},
			{
				method: "reaction_create",
				id: "00000000-0000-4000-8000-000000000011" as MessageReactionId,
				dedupeKey: "dedupe-reaction-create",
			},
			{
				method: "reaction_delete",
				payload: {
					hazelChannelId: THREAD_CHANNEL_ID,
					hazelMessageId: NEW_THREAD_MESSAGE_ID,
					emoji: "🔥",
					userId: AUTHOR_ID,
				},
				dedupeKey: "dedupe-reaction-delete",
			},
		])
	})
})
