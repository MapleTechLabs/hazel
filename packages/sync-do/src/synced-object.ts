/**
 * The wiring most objects want: the broadcaster, the outbox and one alarm over them.
 *
 * - `commit` after every committed write, before answering: flush to sockets, deliver the urgent
 *   kinds, rearm. Then `deliverSoon`, after answering: the outbox, flush what the deliveries wrote
 *   (sender-side effects write locally), rearm. `afterCommit` is both in line.
 * - `alarm` from the object's `alarm()`: expire sockets, retry the outbox, flush, prune, rearm.
 */
import { Cause, Clock, Effect } from "effect"
import type { SqlError } from "effect/sql/SqlError"
import { type AlarmStorageLike, scheduleAlarm } from "./alarm.ts"
import type { OutboxDeliveryError } from "./errors.ts"
import {
	deliverKindsNow,
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
	/**
	 * Outbox kinds `commit` delivers before the caller is answered even while a drain runs (e.g. access
	 * revocations); their receivers must order payloads themselves (`deliverKindsNow`).
	 */
	readonly urgentKinds?: ReadonlyArray<string>
	/** What `commit` spends on urgent kinds per call (default 25 rows, 5 s); the rest go to the alarm. */
	readonly urgentBudget?: { readonly rows?: number; readonly ms?: number }
	/**
	 * How long after `commit` the alarm retries the outbox rows `deliverSoon` did not get to (the
	 * instance went away first; default 10 s).
	 */
	readonly deliveryBackstopMs?: number
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
	const urgentKinds = options.urgentKinds ?? []
	// Bounded so the request answering after them stays well inside its time limit; a delivery
	// the timeout cuts off stays pending and is retried (receivers dedupe by key).
	const urgentNow = deliverKindsNow(options.deliver, urgentKinds, {
		...options.drain,
		limit: options.urgentBudget?.rows ?? 25,
	}).pipe(Effect.timeoutOption(options.urgentBudget?.ms ?? 5_000))

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

	/**
	 * `outboxNotBefore`: the earliest the outbox may arm the alarm for (a backstop for rows a
	 * delivery that is about to run will most likely take care of).
	 */
	const scheduleWith = (outboxNotBefore?: number) =>
		Effect.gen(function* () {
			const pending = yield* outbox.nextAlarm
			const now = yield* Clock.currentTimeMillis
			// Only rows due now are the delivery's to make; a later row keeps its own time.
			const outboxAt =
				pending === undefined || outboxNotBefore === undefined || pending > now
					? pending
					: Math.max(pending, outboxNotBefore)
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
				SqlError: (error) =>
					Effect.logError("Sync alarm scheduling failed", { error: error.message }),
				SyncAlarmError: (error) =>
					Effect.logError("Sync alarm scheduling failed", { error: error.message }),
			}),
			total("alarm scheduling", () => undefined),
		)
	const schedule = scheduleWith()

	const flush = sync.flush.pipe(total("flush", () => sync.headSeq()))
	/** Flush again if a delivery wrote here (a sender-side effect's rows), so they go out now. */
	const flushIfDirty = Effect.suspend(() =>
		sync.headSeq() > sync.flushedSeq() ? flush : Effect.succeed(sync.flushedSeq()),
	)

	/**
	 * What a caller waits for after a write: flush to sockets, deliver the urgent kinds, arm the
	 * alarm (which also covers the outbox rows still pending). Returns the flushed seq (the write
	 * position to hand back to the client); total, so a failure here never fails the committed
	 * write (it is logged and the alarm retries). The rest of the outbox is `deliverSoon`'s.
	 */
	const flushAndDeliverUrgent = Effect.gen(function* () {
		const seq = yield* flush
		if (urgentKinds.length > 0) {
			yield* urgentNow.pipe(
				logSqlError("Outbox urgent delivery failed"),
				total("outbox urgent delivery", () => {}),
			)
		}
		return Math.max(seq, yield* flushIfDirty)
	})
	const commit = Effect.gen(function* () {
		const seq = yield* flushAndDeliverUrgent
		// The rows `deliverSoon` is about to deliver arm a backstop, not an alarm racing it.
		const now = yield* Clock.currentTimeMillis
		yield* scheduleWith(now + (options.deliveryBackstopMs ?? 10_000))
		return seq
	}).pipe(Effect.withSpan("SyncDO.commit"))

	/**
	 * Deliver the outbox now, then flush what the deliveries wrote and rearm. Meant to run after
	 * the caller was answered: a write never waits on another object (a cold one costs seconds).
	 * Total; the alarm `commit` armed retries whatever this does not get to.
	 */
	const deliverSoon = Effect.gen(function* () {
		yield* outbox.drainUntilQuiet.pipe(
			logSqlError("Outbox drain failed"),
			total("outbox drain", () => {}),
		)
		yield* flushIfDirty
		yield* schedule
	}).pipe(Effect.withSpan("SyncDO.deliverSoon"))

	/** `commit` then `deliverSoon`, in line: for callers with nobody waiting (alarms, tests). */
	const afterCommit = Effect.gen(function* () {
		const seq = yield* flushAndDeliverUrgent
		yield* deliverSoon
		return Math.max(seq, sync.flushedSeq())
	}).pipe(Effect.withSpan("SyncDO.afterCommit"))

	const alarm = Effect.gen(function* () {
		yield* sync.closeExpired
		if (sync.headSeq() > sync.flushedSeq()) yield* flush
		yield* outbox.drain.pipe(
			logSqlError("Outbox drain failed"),
			total("outbox drain", () => {}),
		)
		yield* flushIfDirty
		yield* sync.pruneChanges
		yield* pruneInbox().pipe(logSqlError("Inbox prune failed"))
		yield* schedule
	}).pipe(Effect.withSpan("SyncDO.alarm"))

	return { sync, outbox, commit, deliverSoon, afterCommit, alarm, schedule }
}

export type SyncedObject<P, E, R, RD = never, RX = never> = ReturnType<
	typeof makeSyncedObject<P, E, R, RD, RX>
>
