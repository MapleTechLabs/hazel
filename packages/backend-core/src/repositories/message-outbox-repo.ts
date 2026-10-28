import { Database, SQLite, schema } from "@hazel/db"
import { ChannelId, MessageId, MessageOutboxEventId, MessageReactionId, UserId } from "@hazel/schema"
import { Context, Effect, Layer, Schema } from "effect"

export const MessageCreatedPayloadSchema = Schema.Struct({
	messageId: MessageId,
	channelId: ChannelId,
	authorId: UserId,
	content: Schema.String,
	replyToMessageId: Schema.NullOr(MessageId),
})

export const MessageUpdatedPayloadSchema = Schema.Struct({
	messageId: MessageId,
})

export const MessageDeletedPayloadSchema = Schema.Struct({
	messageId: MessageId,
	channelId: Schema.optional(ChannelId),
})

export const ReactionCreatedPayloadSchema = Schema.Struct({
	reactionId: MessageReactionId,
})

export const ReactionDeletedPayloadSchema = Schema.Struct({
	hazelChannelId: ChannelId,
	hazelMessageId: MessageId,
	emoji: Schema.String,
	userId: Schema.optional(UserId),
})

export const MessageOutboxEventType = Schema.Literals([
	"message_created",
	"message_updated",
	"message_deleted",
	"reaction_created",
	"reaction_deleted",
])
export type MessageOutboxEventType = Schema.Schema.Type<typeof MessageOutboxEventType>

export const MessageOutboxEventStatus = Schema.Literals(["pending", "processing", "processed", "failed"])
export type MessageOutboxEventStatus = Schema.Schema.Type<typeof MessageOutboxEventStatus>

export const MessageOutboxEventPayloadSchema = Schema.Union([
	MessageCreatedPayloadSchema,
	MessageUpdatedPayloadSchema,
	MessageDeletedPayloadSchema,
	ReactionCreatedPayloadSchema,
	ReactionDeletedPayloadSchema,
])
export type MessageOutboxEventPayload = Schema.Schema.Type<typeof MessageOutboxEventPayloadSchema>

export type MessageCreatedPayload = Schema.Schema.Type<typeof MessageCreatedPayloadSchema>
export type MessageUpdatedPayload = Schema.Schema.Type<typeof MessageUpdatedPayloadSchema>
export type MessageDeletedPayload = Schema.Schema.Type<typeof MessageDeletedPayloadSchema>
export type ReactionCreatedPayload = Schema.Schema.Type<typeof ReactionCreatedPayloadSchema>
export type ReactionDeletedPayload = Schema.Schema.Type<typeof ReactionDeletedPayloadSchema>

export interface InsertMessageOutboxEvent {
	readonly eventType: MessageOutboxEventType
	readonly aggregateId: string
	readonly channelId: ChannelId
	readonly payload: MessageOutboxEventPayload
}

export interface ClaimNextBatchParams {
	readonly limit: number
	readonly workerId: string
	readonly lockTimeoutMs: number
}

export interface RetryMessageOutboxEventParams {
	readonly availableAt: Date
	readonly lastError: string
}

export interface FailMessageOutboxEventParams {
	readonly lastError: string
}

export type MessageOutboxEventRecord = schema.MessageOutboxEvent

const InsertMessageOutboxEventSchema = Schema.Struct({
	eventType: MessageOutboxEventType,
	aggregateId: Schema.String.check(Schema.isUUID()),
	channelId: ChannelId,
	payload: MessageOutboxEventPayloadSchema,
})

const InsertMessageOutboxEventArraySchema = Schema.Array(InsertMessageOutboxEventSchema)

/**
 * Observes outbox inserts for the current request. A long-running dispatcher polls and needs
 * nothing (the default is a no-op); the Cloudflare Worker installs a per-request recorder and
 * wakes its dispatcher Durable Object once the response is sent and the write has committed.
 */
export class OutboxWrites extends Context.Reference<{ readonly mark: () => void }>("OutboxWrites", {
	defaultValue: () => ({ mark: () => {} }),
}) {}

const markOutboxWrite = Effect.gen(function* () {
	const writes = yield* OutboxWrites
	writes.mark()
})

export class MessageOutboxRepo extends Context.Service<MessageOutboxRepo>()("MessageOutboxRepo", {
	make: Effect.gen(function* () {
		const db = yield* Database.Database

		const insert = (data: InsertMessageOutboxEvent) =>
			Effect.gen(function* () {
				const input = yield* Schema.decodeUnknownEffect(InsertMessageOutboxEventSchema)(data)
				return yield* db.run(
					SQLite.insertInto(schema.messageOutboxEventsTable)
						.values({
							eventType: input.eventType,
							aggregateId: input.aggregateId,
							channelId: input.channelId,
							payload: input.payload as Record<string, unknown>,
						})
						.returning(),
				)
			}).pipe(Effect.tap(() => markOutboxWrite))

		const insertMany = (data: ReadonlyArray<InsertMessageOutboxEvent>) =>
			Effect.gen(function* () {
				const input = yield* Schema.decodeUnknownEffect(InsertMessageOutboxEventArraySchema)(data)
				return yield* db.run(
					SQLite.insertInto(schema.messageOutboxEventsTable)
						.values(
							input.map((event) => ({
								eventType: event.eventType,
								aggregateId: event.aggregateId,
								channelId: event.channelId,
								payload: event.payload as Record<string, unknown>,
							})),
						)
						.returning(),
				)
			}).pipe(Effect.tap(() => markOutboxWrite))

		/**
		 * Claims up to `limit` events: pending events that are due, plus processing events whose lock
		 * went stale. SQLite has one writer, so selecting the candidates and updating exactly those
		 * ids in one transaction is enough to keep two workers from claiming the same event.
		 */
		const claimNextBatch = (params: ClaimNextBatchParams) =>
			db.transaction(
				Effect.gen(function* () {
					const staleBefore = new Date(Date.now() - params.lockTimeoutMs)
					const lockedAt = new Date()

					const candidates = yield* db.run(
						SQLite.from(schema.messageOutboxEventsTable)
							.select("id")
							.where(($) => [
								SQLite.or(
									$.status.eq("pending").and($.availableAt.lte(schema.now())),
									$.status.eq("processing").and($.lockedAt.lt(staleBefore)),
								),
							])
							.orderBy(($) => [[$.sequence, "asc"]])
							.limit(params.limit),
					)
					if (candidates.length === 0) return []

					const rows = yield* db.run(
						SQLite.update(schema.messageOutboxEventsTable)
							.set({
								status: "processing",
								lockedAt,
								lockedBy: params.workerId,
							})
							.where(($) => [$.id.in_(...candidates.map((candidate) => candidate.id))])
							.returning(),
					)

					return rows.slice().sort((left, right) => left.sequence - right.sequence)
				}),
			)

		const markProcessed = (id: MessageOutboxEventId) =>
			db.first(
				SQLite.update(schema.messageOutboxEventsTable)
					.set({
						status: "processed",
						processedAt: new Date(),
						lockedAt: null,
						lockedBy: null,
						lastError: null,
					})
					.where(($) => [$.id.eq(id)])
					.returning(),
			)

		const markRetry = (id: MessageOutboxEventId, params: RetryMessageOutboxEventParams) =>
			db.first(
				SQLite.update(schema.messageOutboxEventsTable)
					.set(($) => ({
						status: "pending" as const,
						availableAt: params.availableAt,
						lastError: params.lastError,
						lockedAt: null,
						lockedBy: null,
						attemptCount: $.attemptCount.add(1),
					}))
					.where(($) => [$.id.eq(id)])
					.returning(),
			)

		const markFailed = (id: MessageOutboxEventId, params: FailMessageOutboxEventParams) =>
			db.first(
				SQLite.update(schema.messageOutboxEventsTable)
					.set(($) => ({
						status: "failed" as const,
						lastError: params.lastError,
						lockedAt: null,
						lockedBy: null,
						attemptCount: $.attemptCount.add(1),
					}))
					.where(($) => [$.id.eq(id)])
					.returning(),
			)

		return {
			insert,
			insertMany,
			claimNextBatch,
			markProcessed,
			markRetry,
			markFailed,
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
