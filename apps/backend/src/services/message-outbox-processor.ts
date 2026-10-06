import {
	MessageCreatedPayloadSchema,
	MessageDeletedPayloadSchema,
	type MessageOutboxEventRecord,
	MessageOutboxRepo,
	MessageUpdatedPayloadSchema,
	ReactionCreatedPayloadSchema,
	ReactionDeletedPayloadSchema,
} from "@hazel/backend-core/repositories"
import { Context, Effect, Layer, Schema } from "effect"
import { formatError } from "../lib/format-error"
import { MessageSideEffectService } from "./message-side-effect-service"

const OUTBOX_BATCH_SIZE = 100
const OUTBOX_LOCK_TIMEOUT_MS = 2 * 60 * 1000
const OUTBOX_FAILURE_LIMIT = 25

const computeRetryDelayMs = (attempt: number): number =>
	Math.min(5_000 * 3 ** Math.max(0, attempt - 1), 300_000)

export interface OutboxBatchResult {
	readonly isEmpty: boolean
	/** Events whose processing failed and were rescheduled for a later attempt. */
	readonly retried: number
}

/**
 * Claims and processes one batch of message outbox events at a time. Claims use
 * `FOR UPDATE SKIP LOCKED` with a lock timeout, so a crashed worker's events are reclaimed.
 * Callers serialize batches (the Bun leader loop, or the dispatcher Durable Object) to keep
 * per-aggregate ordering.
 */
export class MessageOutboxProcessor extends Context.Service<MessageOutboxProcessor>()(
	"MessageOutboxProcessor",
	{
		make: Effect.gen(function* () {
			const outboxRepo = yield* MessageOutboxRepo
			const sideEffects = yield* MessageSideEffectService

			const processEvent = Effect.fn("MessageOutboxDispatcher.processEvent")(function* (
				event: MessageOutboxEventRecord,
			) {
				const dedupeKey = `hazel:outbox:${event.eventType}:${event.aggregateId}:${event.sequence}`

				switch (event.eventType) {
					case "message_created":
						yield* sideEffects.handleMessageCreated(
							Schema.decodeUnknownSync(MessageCreatedPayloadSchema)(event.payload),
							dedupeKey,
						)
						break
					case "message_updated":
						yield* sideEffects.handleMessageUpdated(
							Schema.decodeUnknownSync(MessageUpdatedPayloadSchema)(event.payload),
							dedupeKey,
						)
						break
					case "message_deleted":
						yield* sideEffects.handleMessageDeleted(
							Schema.decodeUnknownSync(MessageDeletedPayloadSchema)(event.payload),
							dedupeKey,
						)
						break
					case "reaction_created":
						yield* sideEffects.handleReactionCreated(
							Schema.decodeUnknownSync(ReactionCreatedPayloadSchema)(event.payload),
							dedupeKey,
						)
						break
					case "reaction_deleted":
						yield* sideEffects.handleReactionDeleted(
							Schema.decodeUnknownSync(ReactionDeletedPayloadSchema)(event.payload),
							dedupeKey,
						)
						break
				}
			})

			const processBatch = Effect.fnUntraced(function* (workerId: string) {
				const batch = yield* outboxRepo.claimNextBatch({
					limit: OUTBOX_BATCH_SIZE,
					workerId,
					lockTimeoutMs: OUTBOX_LOCK_TIMEOUT_MS,
				})

				if (batch.length === 0) {
					return { isEmpty: true, retried: 0 } satisfies OutboxBatchResult
				}

				let retried = 0
				yield* Effect.gen(function* () {
					for (const event of batch) {
						const result = yield* processEvent(event).pipe(Effect.result)
						if (result._tag === "Success") {
							yield* outboxRepo.markProcessed(event.id)
							continue
						}

						const nextAttempt = event.attemptCount + 1
						const errorMessage = formatError(result.failure)

						yield* Effect.logWarning("Outbox event processing failed", {
							eventId: event.id,
							eventType: event.eventType,
							sequence: event.sequence,
							attempt: nextAttempt,
							willRetry: nextAttempt < OUTBOX_FAILURE_LIMIT,
							error: errorMessage,
						})

						if (nextAttempt >= OUTBOX_FAILURE_LIMIT) {
							yield* outboxRepo.markFailed(event.id, {
								lastError: errorMessage,
							})
							continue
						}

						retried++
						yield* outboxRepo.markRetry(event.id, {
							availableAt: new Date(Date.now() + computeRetryDelayMs(nextAttempt)),
							lastError: errorMessage,
						})
					}
				}).pipe(
					Effect.withSpan("MessageOutboxDispatcher.processBatch", {
						attributes: { "batch.size": batch.length },
					}),
				)

				return { isEmpty: false, retried } satisfies OutboxBatchResult
			})

			return { processBatch } as const
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(MessageOutboxRepo.layer),
		Layer.provide(MessageSideEffectService.layer),
	)
}
