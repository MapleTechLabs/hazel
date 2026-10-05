import { randomUUID } from "node:crypto"
import {
	MessageOutboxRepo,
	type MessageCreatedPayload,
	type MessageDeletedPayload,
	type MessageUpdatedPayload,
	type ReactionCreatedPayload,
	type ReactionDeletedPayload,
} from "@hazel/backend-core"
import { Database, asc, eq, inArray, schema } from "@hazel/db"
import type { ChannelId, MessageId, MessageOutboxEventId, UserId } from "@hazel/schema"
import { Effect, Layer, Redacted, Context } from "effect"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { EnvVars } from "../lib/env-vars"
import { createChatSyncDbHarness, type ChatSyncDbHarness } from "../test/chat-sync-db-harness"
import { serviceShape } from "../test/effect-helpers"
import { MessageOutboxDispatcher } from "./message-outbox-dispatcher"
import { MessageOutboxProcessor } from "./message-outbox-processor"
import { MessageSideEffectService } from "./message-side-effect-service"

const CHANNEL_ID = "00000000-0000-4000-8000-000000000001" as ChannelId
const MESSAGE_ID = "00000000-0000-4000-8000-000000000002" as MessageId
const AUTHOR_ID = "00000000-0000-4000-8000-000000000003" as UserId

type SideEffectCall =
	| { eventType: "message_created"; payload: MessageCreatedPayload; dedupeKey: string }
	| { eventType: "message_updated"; payload: MessageUpdatedPayload; dedupeKey: string }
	| { eventType: "message_deleted"; payload: MessageDeletedPayload; dedupeKey: string }
	| { eventType: "reaction_created"; payload: ReactionCreatedPayload; dedupeKey: string }
	| { eventType: "reaction_deleted"; payload: ReactionDeletedPayload; dedupeKey: string }

type SideEffectOptions = {
	failMessageUpdated?: number
	failMessageDeleted?: number
}

const runRepoEffect = <A, E, R>(harness: ChatSyncDbHarness, effect: Effect.Effect<A, E, R>) =>
	harness.run(effect.pipe(Effect.provide(MessageOutboxRepo.layer)))

const runDispatcherEffect = <A, E, R>(
	harness: ChatSyncDbHarness,
	sideEffects: Context.Service.Shape<typeof MessageSideEffectService>,
	make: Effect.Effect<A, E, R>,
) =>
	Effect.runPromise(
		Effect.scoped(
			make.pipe(
				Effect.provide(Layer.effect(MessageOutboxDispatcher, MessageOutboxDispatcher.make)),
				Effect.provide(Layer.effect(MessageOutboxProcessor, MessageOutboxProcessor.make)),
				Effect.provide(Layer.succeed(MessageSideEffectService, sideEffects)),
				Effect.provide(MessageOutboxRepo.layer),
				Effect.provide(
					Layer.succeed(
						EnvVars,
						serviceShape<typeof EnvVars>({
							IS_DEV: true,
							DATABASE_URL: Redacted.make(harness.container.getConnectionUri()),
						}),
					),
				),
				Effect.provide(harness.dbLayer),
			),
		) as Effect.Effect<A, E, never>,
	)

const makeSideEffectService = (calls: SideEffectCall[], options: SideEffectOptions = {}) => {
	let messageUpdatedFailures = 0
	let messageDeletedFailures = 0

	return serviceShape<typeof MessageSideEffectService>({
		handleMessageCreated: (payload: MessageCreatedPayload, dedupeKey: string) =>
			Effect.sync(() => {
				calls.push({ eventType: "message_created", payload, dedupeKey })
			}),
		handleMessageUpdated: (payload: MessageUpdatedPayload, dedupeKey: string) =>
			Effect.gen(function* () {
				if (messageUpdatedFailures < (options.failMessageUpdated ?? 0)) {
					messageUpdatedFailures += 1
					return yield* Effect.fail(new Error("message update failed"))
				}

				calls.push({ eventType: "message_updated", payload, dedupeKey })
			}),
		handleMessageDeleted: (payload: MessageDeletedPayload, dedupeKey: string) =>
			Effect.gen(function* () {
				if (messageDeletedFailures < (options.failMessageDeleted ?? 0)) {
					messageDeletedFailures += 1
					return yield* Effect.fail(new Error("message delete failed"))
				}

				calls.push({ eventType: "message_deleted", payload, dedupeKey })
			}),
		handleReactionCreated: (payload: ReactionCreatedPayload, dedupeKey: string) =>
			Effect.sync(() => {
				calls.push({ eventType: "reaction_created", payload, dedupeKey })
			}),
		handleReactionDeleted: (payload: ReactionDeletedPayload, dedupeKey: string) =>
			Effect.sync(() => {
				calls.push({ eventType: "reaction_deleted", payload, dedupeKey })
			}),
	})
}

const waitFor = async (predicate: () => Promise<boolean>, timeoutMs = 8_000) => {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (await predicate()) {
			return
		}

		await new Promise((resolve) => setTimeout(resolve, 50))
	}

	throw new Error("Timed out waiting for condition")
}

const getOutboxRows = (harness: ChatSyncDbHarness) =>
	harness.run(
		Effect.gen(function* () {
			const db = yield* Database.Database
			return yield* db.execute((client) =>
				client
					.select()
					.from(schema.messageOutboxEventsTable)
					.orderBy(asc(schema.messageOutboxEventsTable.sequence)),
			)
		}),
	)

const getOutboxRowByIds = (harness: ChatSyncDbHarness, ids: ReadonlyArray<MessageOutboxEventId>) =>
	harness.run(
		Effect.gen(function* () {
			const db = yield* Database.Database
			return yield* db.execute((client) =>
				client
					.select()
					.from(schema.messageOutboxEventsTable)
					.where(inArray(schema.messageOutboxEventsTable.id, [...ids])),
			)
		}),
	)

describe("MessageOutboxDispatcher", () => {
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

	it("processes events in sequence order", async () => {
		const calls: SideEffectCall[] = []

		const [createdEvent, deletedEvent] = await runRepoEffect(
			harness,
			Effect.gen(function* () {
				const repo = yield* MessageOutboxRepo

				const [created] = yield* repo.insert({
					eventType: "message_created",
					aggregateId: MESSAGE_ID,
					channelId: CHANNEL_ID,
					payload: {
						messageId: MESSAGE_ID,
						channelId: CHANNEL_ID,
						authorId: AUTHOR_ID,
						content: "hello",
						replyToMessageId: null,
					},
				})
				const [deleted] = yield* repo.insert({
					eventType: "message_deleted",
					aggregateId: MESSAGE_ID,
					channelId: CHANNEL_ID,
					payload: {
						messageId: MESSAGE_ID,
						channelId: CHANNEL_ID,
					},
				})

				return [created, deleted] as const
			}),
		)

		await runDispatcherEffect(
			harness,
			makeSideEffectService(calls),
			Effect.gen(function* () {
				yield* MessageOutboxDispatcher
				yield* Effect.promise(() =>
					waitFor(async () => {
						const rows = await getOutboxRowByIds(harness, [createdEvent.id, deletedEvent.id])
						return rows.every((row) => row.status === "processed")
					}),
				)
			}),
		)

		expect(calls.map((call) => call.eventType)).toEqual(["message_created", "message_deleted"])
		expect(calls[0]?.dedupeKey).toBe(
			`hazel:outbox:message_created:${MESSAGE_ID}:${createdEvent.sequence}`,
		)
		expect(calls[1]?.dedupeKey).toBe(
			`hazel:outbox:message_deleted:${MESSAGE_ID}:${deletedEvent.sequence}`,
		)
	})

	it("marks failed attempts for retry with backoff", async () => {
		const calls: SideEffectCall[] = []

		const [event] = await runRepoEffect(
			harness,
			Effect.gen(function* () {
				const repo = yield* MessageOutboxRepo
				return yield* repo.insert({
					eventType: "message_updated",
					aggregateId: MESSAGE_ID,
					channelId: CHANNEL_ID,
					payload: {
						messageId: MESSAGE_ID,
					},
				})
			}),
		)

		await runDispatcherEffect(
			harness,
			makeSideEffectService(calls, { failMessageUpdated: 1 }),
			Effect.gen(function* () {
				yield* MessageOutboxDispatcher
				yield* Effect.promise(() =>
					waitFor(async () => {
						const rows = await getOutboxRowByIds(harness, [event.id])
						const row = rows[0]
						return (
							row?.status === "pending" &&
							row.attemptCount === 1 &&
							row.availableAt.getTime() > Date.now()
						)
					}),
				)
			}),
		)

		expect(calls).toHaveLength(0)
		const [row] = await getOutboxRowByIds(harness, [event.id])
		expect(row?.lastError).toContain("message update failed")
	})

	it("marks rows as failed after the final retry", async () => {
		const calls: SideEffectCall[] = []

		const [event] = await runRepoEffect(
			harness,
			Effect.gen(function* () {
				const db = yield* Database.Database
				const repo = yield* MessageOutboxRepo
				const [inserted] = yield* repo.insert({
					eventType: "message_deleted",
					aggregateId: MESSAGE_ID,
					channelId: CHANNEL_ID,
					payload: {
						messageId: MESSAGE_ID,
						channelId: CHANNEL_ID,
					},
				})

				yield* db.execute((client) =>
					client
						.update(schema.messageOutboxEventsTable)
						.set({
							attemptCount: 24,
						})
						.where(eq(schema.messageOutboxEventsTable.id, inserted.id)),
				)

				return [inserted] as const
			}),
		)

		await runDispatcherEffect(
			harness,
			makeSideEffectService(calls, { failMessageDeleted: 1 }),
			Effect.gen(function* () {
				yield* MessageOutboxDispatcher
				yield* Effect.promise(() =>
					waitFor(async () => {
						const rows = await getOutboxRowByIds(harness, [event.id])
						return rows[0]?.status === "failed"
					}),
				)
			}),
		)

		expect(calls).toHaveLength(0)
		const [row] = await getOutboxRowByIds(harness, [event.id])
		expect(row?.attemptCount).toBe(25)
		expect(row?.status).toBe("failed")
	})

	it("does not double-dispatch when two dispatcher instances are running", async () => {
		const calls: SideEffectCall[] = []

		await runRepoEffect(
			harness,
			Effect.gen(function* () {
				const repo = yield* MessageOutboxRepo
				yield* repo.insert({
					eventType: "message_created",
					aggregateId: MESSAGE_ID,
					channelId: CHANNEL_ID,
					payload: {
						messageId: MESSAGE_ID,
						channelId: CHANNEL_ID,
						authorId: AUTHOR_ID,
						content: "hello",
						replyToMessageId: null,
					},
				})
			}),
		)

		const service = makeSideEffectService(calls)

		await Promise.all([
			runDispatcherEffect(
				harness,
				service,
				Effect.gen(function* () {
					yield* MessageOutboxDispatcher
					yield* Effect.promise(() =>
						waitFor(async () => {
							const rows = await getOutboxRows(harness)
							return rows[0]?.status === "processed"
						}),
					)
					yield* Effect.sleep("1 second")
				}),
			),
			runDispatcherEffect(
				harness,
				service,
				Effect.gen(function* () {
					yield* MessageOutboxDispatcher
					yield* Effect.sleep("500 millis")
				}),
			),
		])

		expect(calls).toHaveLength(1)
		expect(calls[0]?.eventType).toBe("message_created")
	})
})
