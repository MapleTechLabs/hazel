import { Pool, type PoolClient } from "pg"
import { Database } from "@hazel/db"
import { Context, Effect, Layer, Redacted } from "effect"
import { EnvVars } from "../lib/env-vars"
import { MessageOutboxProcessor } from "./message-outbox-processor"

const OUTBOX_POLL_MIN_MS = 250
const OUTBOX_POLL_MAX_MS = 2_000
const OUTBOX_LOCK_RETRY_INTERVAL = "5 seconds"
const OUTBOX_DISPATCHER_LOCK_KEY = 1_046_277_921

export class MessageOutboxDispatcher extends Context.Service<MessageOutboxDispatcher>()(
	"MessageOutboxDispatcher",
	{
		make: Effect.gen(function* () {
			const envVars = yield* EnvVars
			const database = yield* Database.Database
			const processor = yield* MessageOutboxProcessor
			const workerId = `backend-outbox-${crypto.randomUUID()}`

			const pool = yield* Effect.acquireRelease(
				Effect.sync(
					() =>
						new Pool({
							connectionString: Redacted.value(envVars.DATABASE_URL),
							ssl: envVars.IS_DEV ? false : { rejectUnauthorized: false },
							max: 1,
						}),
				),
				(sqlClient) => Effect.promise(() => sqlClient.end()),
			)

			const releaseReservedConnection = (reserved: PoolClient) =>
				Effect.gen(function* () {
					yield* Effect.tryPromise({
						try: () =>
							reserved.query<{ unlocked: boolean }>(
								"SELECT pg_advisory_unlock($1) AS unlocked",
								[OUTBOX_DISPATCHER_LOCK_KEY],
							),
						catch: () => null,
					}).pipe(Effect.ignore)
					yield* Effect.sync(() => reserved.release())
				})

			const processBatch = () => processor.processBatch(workerId)

			const runLeaderLoop = Effect.gen(function* () {
				let pollDelayMs = OUTBOX_POLL_MIN_MS

				yield* Effect.forever(
					Effect.gen(function* () {
						const result = yield* processBatch()
						if (result.isEmpty) {
							yield* Effect.sleep(`${pollDelayMs} millis`)
							pollDelayMs = Math.min(pollDelayMs * 2, OUTBOX_POLL_MAX_MS)
						} else {
							pollDelayMs = OUTBOX_POLL_MIN_MS
						}
					}).pipe(
						Effect.provideService(Database.Database, database),
						Effect.catch((error) =>
							Effect.gen(function* () {
								yield* Effect.logError("Message outbox batch failed", {
									workerId,
									error: String(error),
								})
								yield* Effect.sleep("1 second")
								pollDelayMs = OUTBOX_POLL_MIN_MS
							}),
						),
					),
				)
			})

			const campaignForLeadership = (): Effect.Effect<void, never, unknown> =>
				Effect.gen(function* () {
					const reservedResult = yield* Effect.tryPromise({
						try: (): Promise<PoolClient> => pool.connect(),
						catch: (cause) => new Error(String(cause)),
					}).pipe(Effect.result)

					if (reservedResult._tag === "Failure") {
						yield* Effect.logError("Failed to reserve outbox advisory lock connection", {
							error: String(reservedResult.failure),
						})
						yield* Effect.sleep(OUTBOX_LOCK_RETRY_INTERVAL)
						return yield* campaignForLeadership()
					}
					const reserved = reservedResult.success

					const lockResult = yield* Effect.tryPromise({
						try: () =>
							reserved.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1) AS locked", [
								OUTBOX_DISPATCHER_LOCK_KEY,
							]),
						catch: (cause) => new Error(String(cause)),
					}).pipe(Effect.result)

					if (lockResult._tag === "Failure") {
						yield* Effect.logError("Failed to acquire outbox advisory lock", {
							error: String(lockResult.failure),
						})
						yield* Effect.sync(() => reserved.release())
						yield* Effect.sleep(OUTBOX_LOCK_RETRY_INTERVAL)
						return yield* campaignForLeadership()
					}

					const lockRows = lockResult.success as { rows: Array<{ locked: boolean }> }
					if (!lockRows.rows[0]?.locked) {
						yield* Effect.sync(() => reserved.release())
						yield* Effect.sleep(OUTBOX_LOCK_RETRY_INTERVAL)
						return yield* campaignForLeadership()
					}

					yield* Effect.logInfo("Message outbox dispatcher acquired leadership", {
						workerId,
					})

					yield* runLeaderLoop.pipe(
						Effect.ensuring(releaseReservedConnection(reserved)),
						Effect.catchCause((cause) =>
							Effect.logError("Message outbox dispatcher leader loop stopped", {
								workerId,
								cause: String(cause),
							}),
						),
					)

					yield* Effect.sleep(OUTBOX_LOCK_RETRY_INTERVAL)
					return yield* campaignForLeadership()
				})

			yield* campaignForLeadership().pipe(Effect.forkScoped)

			return {
				start: Effect.void,
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(EnvVars.layer),
		Layer.provide(MessageOutboxProcessor.layer),
	)
}
