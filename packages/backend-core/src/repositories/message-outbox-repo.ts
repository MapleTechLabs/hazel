import { Database, and, asc, eq, inArray, or, schema, sql } from "@hazel/db"
import type { DatabaseError, TxFn } from "@hazel/db"
import { ChannelId, MessageId, MessageOutboxEventId, MessageReactionId, UserId } from "@hazel/schema"
import { Context, Effect, Layer, Option, Schema } from "effect"

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

export type MessageOutboxEventRecord = typeof schema.messageOutboxEventsTable.$inferSelect

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

		const insert = (data: InsertMessageOutboxEvent, tx?: TxFn) =>
			db
				.makeQueryWithSchema(InsertMessageOutboxEventSchema, (execute, input) =>
					execute((client) =>
						client
							.insert(schema.messageOutboxEventsTable)
							.values({
								eventType: input.eventType,
								aggregateId: input.aggregateId,
								channelId: input.channelId,
								payload: input.payload as Record<string, unknown>,
							})
							.returning(),
					),
				)(data, tx)
				.pipe(Effect.tap(() => markOutboxWrite))

		const insertMany = (data: ReadonlyArray<InsertMessageOutboxEvent>, tx?: TxFn) =>
			db
				.makeQueryWithSchema(InsertMessageOutboxEventArraySchema, (execute, input) =>
					execute((client) =>
						client
							.insert(schema.messageOutboxEventsTable)
							.values(
								input.map((event) => ({
									eventType: event.eventType,
									aggregateId: event.aggregateId,
									channelId: event.channelId,
									payload: event.payload as Record<string, unknown>,
								})),
							)
							.returning(),
					),
				)(data, tx)
				.pipe(Effect.tap(() => markOutboxWrite))

		const claimNextBatch = (params: ClaimNextBatchParams, tx?: TxFn) =>
			db.makeQuery((execute, data: ClaimNextBatchParams) => {
				const staleBefore = new Date(Date.now() - data.lockTimeoutMs).toISOString()
				const lockedAt = new Date().toISOString()
				return execute(
					(client) =>
						(
							client as typeof client & {
								$client: {
									<T>(
										strings: TemplateStringsArray,
										...values: ReadonlyArray<unknown>
									): Promise<T>
								}
							}
						).$client<Array<MessageOutboxEventRecord>>`
						WITH candidates AS (
							SELECT id
							FROM "message_outbox_events"
							WHERE (
								"status" = 'pending'
								AND "availableAt" <= now()
							) OR (
								"status" = 'processing'
								AND "lockedAt" < ${staleBefore}
							)
							ORDER BY "sequence" ASC
							LIMIT ${data.limit}
							FOR UPDATE SKIP LOCKED
						)
						UPDATE "message_outbox_events" AS events
						SET
							"status" = 'processing',
							"lockedAt" = ${lockedAt},
							"lockedBy" = ${data.workerId}
						FROM candidates
						WHERE events.id = candidates.id
						RETURNING events.*;
					`,
				).pipe(
					Effect.map(
						(rows) =>
							rows
								.slice()
								.sort(
									(left, right) => left.sequence - right.sequence,
								) as Array<MessageOutboxEventRecord>,
					),
				)
			})(params, tx)

		const markProcessed = (id: MessageOutboxEventId, tx?: TxFn) =>
			db.makeQuery((execute, eventId: MessageOutboxEventId) =>
				execute((client) =>
					client
						.update(schema.messageOutboxEventsTable)
						.set({
							status: "processed",
							processedAt: new Date(),
							lockedAt: null,
							lockedBy: null,
							lastError: null,
						})
						.where(eq(schema.messageOutboxEventsTable.id, eventId))
						.returning(),
				).pipe(Effect.map((rows) => Option.fromNullishOr(rows[0]))),
			)(id, tx)

		const markRetry = (id: MessageOutboxEventId, params: RetryMessageOutboxEventParams, tx?: TxFn) =>
			db.makeQuery(
				(
					execute,
					data: {
						id: MessageOutboxEventId
						availableAt: Date
						lastError: string
					},
				) =>
					execute((client) =>
						client
							.update(schema.messageOutboxEventsTable)
							.set({
								status: "pending",
								availableAt: data.availableAt,
								lastError: data.lastError,
								lockedAt: null,
								lockedBy: null,
								attemptCount: sql`${schema.messageOutboxEventsTable.attemptCount} + 1`,
							})
							.where(eq(schema.messageOutboxEventsTable.id, data.id))
							.returning(),
					).pipe(Effect.map((rows) => Option.fromNullishOr(rows[0]))),
			)(
				{
					id,
					availableAt: params.availableAt,
					lastError: params.lastError,
				},
				tx,
			)

		const markFailed = (id: MessageOutboxEventId, params: FailMessageOutboxEventParams, tx?: TxFn) =>
			db.makeQuery(
				(
					execute,
					data: {
						id: MessageOutboxEventId
						lastError: string
					},
				) =>
					execute((client) =>
						client
							.update(schema.messageOutboxEventsTable)
							.set({
								status: "failed",
								lastError: data.lastError,
								lockedAt: null,
								lockedBy: null,
								attemptCount: sql`${schema.messageOutboxEventsTable.attemptCount} + 1`,
							})
							.where(eq(schema.messageOutboxEventsTable.id, data.id))
							.returning(),
					).pipe(Effect.map((rows) => Option.fromNullishOr(rows[0]))),
			)(
				{
					id,
					lastError: params.lastError,
				},
				tx,
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
