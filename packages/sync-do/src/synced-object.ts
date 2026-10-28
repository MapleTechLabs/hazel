/**
 * The wiring most objects want: the broadcaster, the outbox and one alarm over them.
 *
 * - `afterCommit` after every committed write: flush to sockets, deliver the outbox, rearm.
 * - `alarm` from the object's `alarm()`: expire sockets, retry the outbox, prune, rearm.
 */
import { Effect } from "effect"
import type { SqlError } from "effect/sql/SqlError"
import { type AlarmStorageLike, scheduleAlarm } from "./alarm.ts"
import type { OutboxDeliveryError } from "./errors.ts"
import {
	type DrainOptions,
	installOutbox,
	makeOutbox,
	nextInboxPruneAt,
	type OutboxRow,
	pruneInbox,
} from "./outbox.ts"
import { makeSyncRuntime, type SyncObjectState, type SyncRuntimeOptions } from "./runtime.ts"
import type { SyncSource } from "./source.ts"
import type { SqlStorageLike } from "./sql-storage.ts"

export interface SyncedObjectOptions<P, E, R, RD, RX> {
	/** `ctx.storage`: its `sql` and alarm calls. */
	readonly storage: AlarmStorageLike & { readonly sql: SqlStorageLike }
	readonly state: SyncObjectState
	readonly source: SyncSource<P, E, R>
	readonly deliver: (row: OutboxRow) => Effect.Effect<void, OutboxDeliveryError, RD>
	/** The object's own deadlines (e.g. typing expiry), folded into the one alarm. */
	readonly deadlines?: Effect.Effect<ReadonlyArray<number | null | undefined>, never, RX>
	readonly runtime?: SyncRuntimeOptions
	readonly drain?: DrainOptions
}

export const makeSyncedObject = <P, E, R, RD = never, RX = never>(
	options: SyncedObjectOptions<P, E, R, RD, RX>,
) => {
	installOutbox(options.storage.sql)
	const sync = makeSyncRuntime({
		sql: options.storage.sql,
		state: options.state,
		source: options.source,
		options: options.runtime,
	})
	const outbox = makeOutbox(options.deliver, options.drain)
	const extra = options.deadlines ?? Effect.succeed([])

	const logSqlError =
		(message: string) =>
		<A, R2>(self: Effect.Effect<A, SqlError, R2>) =>
			self.pipe(
				Effect.catchTag("SqlError", (error) => Effect.logError(message, { error: error.message })),
			)

	const schedule = Effect.gen(function* () {
		const outboxAt = yield* outbox.nextAlarm
		const inboxAt = yield* nextInboxPruneAt()
		const own = yield* extra
		return yield* scheduleAlarm(options.storage, [...sync.deadlines(), outboxAt, inboxAt, ...own])
	}).pipe(logSqlError("Sync alarm scheduling failed"))

	/** Returns the flushed seq (the write position to hand back to the client). */
	const afterCommit = Effect.gen(function* () {
		const seq = yield* sync.flush
		yield* outbox.drainIfIdle.pipe(logSqlError("Outbox drain failed"))
		yield* schedule
		return seq
	})

	const alarm = Effect.gen(function* () {
		yield* sync.closeExpired
		yield* outbox.drain.pipe(logSqlError("Outbox drain failed"))
		yield* sync.pruneChanges
		yield* pruneInbox().pipe(logSqlError("Inbox prune failed"))
		yield* schedule
	}).pipe(Effect.withSpan("SyncDO.alarm"))

	return { sync, outbox, afterCommit, alarm, schedule }
}

export type SyncedObject<P, E, R, RD = never, RX = never> = ReturnType<
	typeof makeSyncedObject<P, E, R, RD, RX>
>
