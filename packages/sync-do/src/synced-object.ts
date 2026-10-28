/**
 * The wiring most objects want: the broadcaster, the outbox and one alarm over them.
 *
 * - `afterCommit` after every committed write: flush to sockets, deliver the outbox, rearm.
 * - `alarm` from the object's `alarm()`: expire sockets, retry the outbox, prune, rearm.
 */
import { Cause, Clock, Effect } from "effect"
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

	/**
	 * Never fail after the write committed (a failure makes the client retry, so duplicates):
	 * defects are logged and `fallback` returned; interrupts still propagate.
	 */
	const total =
		<B>(label: string, fallback: () => B) =>
		<A, R2>(self: Effect.Effect<A, never, R2>): Effect.Effect<A | B, never, R2> =>
			self.pipe(
				Effect.catchCause((cause) =>
					Cause.hasInterruptsOnly(cause)
						? Effect.interrupt
						: Effect.as(
								Effect.logError(`Sync ${label} failed`, { cause: Cause.pretty(cause) }),
								fallback(),
							),
				),
			)

	/** A commit nobody flushed yet (the instance died first, or a flush failed): flush soon. */
	const unflushedAt = Effect.map(Clock.currentTimeMillis, (now) =>
		sync.headSeq() > sync.flushedSeq() ? now : undefined,
	)

	const schedule = Effect.gen(function* () {
		const outboxAt = yield* outbox.nextAlarm
		const inboxAt = yield* nextInboxPruneAt()
		const own = yield* extra
		const unflushed = yield* unflushedAt
		return yield* scheduleAlarm(options.storage, [
			...sync.deadlines(),
			outboxAt,
			inboxAt,
			unflushed,
			...own,
		])
	}).pipe(
		Effect.catchTags({
			SqlError: (error) => Effect.logError("Sync alarm scheduling failed", { error: error.message }),
			SyncAlarmError: (error) =>
				Effect.logError("Sync alarm scheduling failed", { error: error.message }),
		}),
		total("alarm scheduling", () => undefined),
	)

	const flush = sync.flush.pipe(total("flush", () => sync.headSeq()))

	/**
	 * Returns the flushed seq (the write position to hand back to the client); total, so a failure
	 * here never fails the committed write (it is logged and the alarm retries).
	 */
	const afterCommit = Effect.gen(function* () {
		const seq = yield* flush
		yield* outbox.drainIfIdle.pipe(
			logSqlError("Outbox drain failed"),
			total("outbox drain", () => {}),
		)
		yield* schedule
		return seq
	}).pipe(Effect.withSpan("SyncDO.afterCommit"))

	const alarm = Effect.gen(function* () {
		yield* sync.closeExpired
		if (sync.headSeq() > sync.flushedSeq()) yield* flush
		yield* outbox.drain.pipe(
			logSqlError("Outbox drain failed"),
			total("outbox drain", () => {}),
		)
		yield* sync.pruneChanges
		yield* pruneInbox().pipe(logSqlError("Inbox prune failed"))
		yield* schedule
	}).pipe(Effect.withSpan("SyncDO.alarm"))

	return { sync, outbox, afterCommit, alarm, schedule }
}

export type SyncedObject<P, E, R, RD = never, RX = never> = ReturnType<
	typeof makeSyncedObject<P, E, R, RD, RX>
>
