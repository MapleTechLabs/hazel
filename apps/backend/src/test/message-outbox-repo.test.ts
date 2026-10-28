import { randomUUID } from "node:crypto"
import { MessageOutboxRepo } from "@hazel/backend-core"
import { Database, SQLite, schema } from "@hazel/db"
import type { ChannelId, MessageId, MessageReactionId, UserId } from "@hazel/schema"
import { Effect } from "effect"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createChatSyncDbHarness, type ChatSyncDbHarness } from "./chat-sync-db-harness"

const CHANNEL_ID = "00000000-0000-4000-8000-000000000001" as ChannelId
const AUTHOR_ID = "00000000-0000-4000-8000-000000000102" as UserId
const MESSAGE_ID_1 = "00000000-0000-4000-8000-000000000101" as MessageId
const MESSAGE_ID_2 = "00000000-0000-4000-8000-000000000103" as MessageId
const MESSAGE_ID_3 = "00000000-0000-4000-8000-000000000105" as MessageId
const MESSAGE_ID_4 = "00000000-0000-4000-8000-000000000106" as MessageId
const MESSAGE_ID_5 = "00000000-0000-4000-8000-000000000107" as MessageId
const MESSAGE_ID_6 = "00000000-0000-4000-8000-000000000109" as MessageId
const REACTION_ID = "00000000-0000-4000-8000-000000000104" as MessageReactionId
const REACTION_USER_ID = "00000000-0000-4000-8000-000000000108" as UserId
const SECOND_AUTHOR_ID = "00000000-0000-4000-8000-000000000110" as UserId

const uuid = () => randomUUID()

const runRepoEffect = <A, E, R>(harness: ChatSyncDbHarness, effect: Effect.Effect<A, E, R>) =>
	harness.run(effect.pipe(Effect.provide(MessageOutboxRepo.layer)))

describe("MessageOutboxRepo", () => {
	let harness: ChatSyncDbHarness

	beforeAll(async () => {
		harness = await createChatSyncDbHarness()
	}, 120_000)

	beforeEach(async () => {
		await harness.reset()
	})

	afterAll(async () => {
		await harness.stop()
	}, 60_000)

	it("claims rows in sequence order", async () => {
		const claimed = await runRepoEffect(
			harness,
			Effect.gen(function* () {
				const repo = yield* MessageOutboxRepo

				yield* repo.insert({
					eventType: "message_created",
					aggregateId: uuid(),
					channelId: CHANNEL_ID,
					payload: {
						messageId: MESSAGE_ID_1,
						channelId: CHANNEL_ID,
						authorId: AUTHOR_ID,
						content: "first",
						replyToMessageId: null,
					},
				})
				yield* repo.insert({
					eventType: "message_updated",
					aggregateId: uuid(),
					channelId: CHANNEL_ID,
					payload: {
						messageId: MESSAGE_ID_2,
					},
				})
				yield* repo.insert({
					eventType: "reaction_created",
					aggregateId: uuid(),
					channelId: CHANNEL_ID,
					payload: {
						reactionId: REACTION_ID,
					},
				})

				return yield* repo.claimNextBatch({
					limit: 10,
					workerId: "worker-1",
					lockTimeoutMs: 120_000,
				})
			}),
		)

		expect(claimed).toHaveLength(3)
		expect(claimed.map((event) => event.sequence)).toEqual(
			[...claimed.map((event) => event.sequence)].sort((left, right) => left - right),
		)
		expect(claimed.map((event) => event.eventType)).toEqual([
			"message_created",
			"message_updated",
			"reaction_created",
		])
	})

	it("ignores rows that are not yet available", async () => {
		await runRepoEffect(
			harness,
			Effect.gen(function* () {
				const db = yield* Database.Database
				const repo = yield* MessageOutboxRepo

				const [futureEvent] = yield* repo.insert({
					eventType: "message_updated",
					aggregateId: uuid(),
					channelId: CHANNEL_ID,
					payload: {
						messageId: MESSAGE_ID_3,
					},
				})

				yield* db.run(
					SQLite.update(schema.messageOutboxEventsTable)
						.set({
							availableAt: new Date(Date.now() + 60_000),
						})
						.where(($) => [$.id.eq(futureEvent.id)]),
				)

				yield* repo.insert({
					eventType: "message_deleted",
					aggregateId: uuid(),
					channelId: CHANNEL_ID,
					payload: {
						messageId: MESSAGE_ID_4,
						channelId: CHANNEL_ID,
					},
				})
			}),
		)

		const claimed = await runRepoEffect(
			harness,
			Effect.gen(function* () {
				const repo = yield* MessageOutboxRepo
				return yield* repo.claimNextBatch({
					limit: 10,
					workerId: "worker-1",
					lockTimeoutMs: 120_000,
				})
			}),
		)

		expect(claimed).toHaveLength(1)
		expect(claimed[0]?.eventType).toBe("message_deleted")
	})

	it("reclaims stale processing rows after the lock timeout", async () => {
		const claimed = await runRepoEffect(
			harness,
			Effect.gen(function* () {
				const db = yield* Database.Database
				const repo = yield* MessageOutboxRepo

				const [event] = yield* repo.insert({
					eventType: "reaction_deleted",
					aggregateId: uuid(),
					channelId: CHANNEL_ID,
					payload: {
						hazelChannelId: CHANNEL_ID,
						hazelMessageId: MESSAGE_ID_5,
						emoji: "🔥",
						userId: REACTION_USER_ID,
					},
				})

				yield* db.run(
					SQLite.update(schema.messageOutboxEventsTable)
						.set({
							status: "processing",
							lockedAt: new Date(Date.now() - 180_000),
							lockedBy: "old-worker",
						})
						.where(($) => [$.id.eq(event.id)]),
				)

				return yield* repo.claimNextBatch({
					limit: 10,
					workerId: "worker-2",
					lockTimeoutMs: 120_000,
				})
			}),
		)

		expect(claimed).toHaveLength(1)
		expect(claimed[0]?.lockedBy).toBe("worker-2")
		expect(claimed[0]?.status).toBe("processing")
	})

	it("does not claim the same row twice", async () => {
		const [firstClaim, secondClaim] = await runRepoEffect(
			harness,
			Effect.gen(function* () {
				const repo = yield* MessageOutboxRepo

				yield* repo.insert({
					eventType: "message_created",
					aggregateId: uuid(),
					channelId: CHANNEL_ID,
					payload: {
						messageId: MESSAGE_ID_6,
						channelId: CHANNEL_ID,
						authorId: SECOND_AUTHOR_ID,
						content: "hello",
						replyToMessageId: null,
					},
				})

				const claimedOnce = yield* repo.claimNextBatch({
					limit: 10,
					workerId: "worker-1",
					lockTimeoutMs: 120_000,
				})
				const claimedTwice = yield* repo.claimNextBatch({
					limit: 10,
					workerId: "worker-2",
					lockTimeoutMs: 120_000,
				})

				return [claimedOnce, claimedTwice] as const
			}),
		)

		expect(firstClaim).toHaveLength(1)
		expect(secondClaim).toHaveLength(0)
	})
})
