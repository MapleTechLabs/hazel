/**
 * Cross-object side effects, delivered at least once: `enqueue` writes an `_outbox` row through the
 * object's effect `SqlClient`, so it commits or rolls back with the caller's transaction. The object
 * drains right after its commit; the alarm retries with backoff. Receivers dedupe with `withInbox`.
 */
import { Cause, Clock, Effect, Exit, Option, Random, Semaphore } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import type { SqlError } from "effect/sql/SqlError"
import { OutboxDeliveryError } from "./errors.ts"
import type { SqlStorageLike } from "./sql-storage.ts"

const SCHEMA = [
	`CREATE TABLE IF NOT EXISTS _outbox (
		id TEXT PRIMARY KEY,
		target TEXT NOT NULL,
		kind TEXT NOT NULL,
		payload TEXT NOT NULL,
		attempts INTEGER NOT NULL DEFAULT 0,
		next_at INTEGER NOT NULL,
		last_error TEXT,
		created_at INTEGER NOT NULL,
		status TEXT NOT NULL DEFAULT 'pending'
	)`,
	`CREATE INDEX IF NOT EXISTS _outbox_due ON _outbox (status, next_at)`,
	`CREATE INDEX IF NOT EXISTS _outbox_target ON _outbox (status, target)`,
	`CREATE TABLE IF NOT EXISTS _inbox (
		key TEXT PRIMARY KEY,
		at INTEGER NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS _inbox_at ON _inbox (at)`,
]

/** Create `_outbox` and `_inbox`. Idempotent; run on every activation. */
export const installOutbox = (sql: SqlStorageLike): void => {
	for (const statement of SCHEMA) sql.exec(statement)
}

export interface OutboxMessage {
	/** Defaults to a random UUID. Also the receiver's inbox key, so retries dedupe. */
	readonly id?: string
	/** Where it goes, e.g. `org:<id>`; rows to one target are delivered in order. */
	readonly target: string
	readonly kind: string
	/** JSON-serializable. */
	readonly payload: unknown
	/** Not delivered before this time (epoch ms): the alarm sends it, not the write's own drain. */
	readonly notBefore?: number
}

export interface OutboxRow {
	readonly id: string
	readonly target: string
	readonly kind: string
	readonly payload: unknown
	/** Failed attempts so far. */
	readonly attempts: number
	readonly createdAt: number
}

/** Write an outbox row; joins the caller's transaction. Returns the row id. */
export const enqueue = (message: OutboxMessage): Effect.Effect<string, SqlError, SqlClient> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient
		const now = yield* Clock.currentTimeMillis
		const id = message.id ?? crypto.randomUUID()
		const payload = JSON.stringify(message.payload ?? null)
		const nextAt = Math.max(now, message.notBefore ?? now)
		yield* sql`INSERT INTO _outbox (id, target, kind, payload, attempts, next_at, created_at, status)
			VALUES (${id}, ${message.target}, ${message.kind}, ${payload}, 0, ${nextAt}, ${now}, 'pending')
			ON CONFLICT (id) DO NOTHING`
		return id
	})

export interface BackoffPolicy {
	readonly baseMs: number
	readonly capMs: number
}

/** Retryable failures retry forever, at most `capMs` apart; only non-retryable ones go dead. */
export const DEFAULT_BACKOFF: BackoffPolicy = { baseMs: 5_000, capMs: 10 * 60_000 }

/** Each delivery attempt fails (retryably) after this long. */
export const DEFAULT_DELIVERY_TIMEOUT_MS = 10_000

/** Delay after the `attempts`-th failure: exponential, capped, ±25% jitter (`random` in [0, 1)). */
export const backoffDelayMs = (attempts: number, random: number, policy: BackoffPolicy = DEFAULT_BACKOFF) => {
	const exponential = Math.min(policy.capMs, policy.baseMs * 2 ** Math.max(0, Math.min(attempts - 1, 40)))
	return Math.round(Math.min(policy.capMs, exponential * (0.75 + 0.5 * random)))
}

export interface DrainResult {
	readonly delivered: number
	readonly retried: number
	readonly dead: number
	/** The earliest target head's due time, for the alarm. */
	readonly nextAt: number | undefined
}

export interface DrainOptions {
	/** Delivery attempts per drain (over all targets). */
	readonly limit?: number
	readonly backoff?: Partial<BackoffPolicy>
	/** Per-attempt timeout; a timeout is a retryable failure. */
	readonly deliveryTimeoutMs?: number
}

type RawOutboxRow = {
	readonly id: string
	readonly target: string
	readonly kind: string
	readonly payload: string
	readonly attempts: number
	readonly next_at: number
	readonly created_at: number
}

const COLUMNS = `o.id, o.target, o.kind, o.payload, o.attempts, o.next_at, o.created_at`
/** Each target's head: its oldest pending row. Rows behind a head wait for it (per-target FIFO). */
const HEADS = `SELECT MIN(rowid) AS head FROM _outbox WHERE status = 'pending' GROUP BY target`

/** When the earliest target head is due, or `undefined` when nothing is pending. */
export const nextOutboxAlarm: Effect.Effect<number | undefined, SqlError, SqlClient> = Effect.gen(
	function* () {
		const sql = yield* SqlClient
		const rows = yield* sql<{ next: number | null }>`SELECT MIN(o.next_at) AS next
			FROM _outbox o JOIN (${sql.literal(HEADS)}) h ON o.rowid = h.head`
		const next = rows[0]?.next
		return next === null || next === undefined ? undefined : Number(next)
	},
)

/**
 * Deliver due rows in order per target: only each target's head is considered, and a target keeps
 * going while its next row is due and delivery succeeds. A retryable failure (or a defect or
 * timeout) backs the head off and holds its target; other targets are unaffected. A non-retryable
 * failure marks the row `dead` and its target moves on. Not single-flight; `makeOutbox` serializes.
 */
export const drainOutbox = <R>(
	deliver: (row: OutboxRow) => Effect.Effect<void, OutboxDeliveryError, R>,
	options?: DrainOptions,
): Effect.Effect<DrainResult, SqlError, SqlClient | R> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient
		const policy: BackoffPolicy = { ...DEFAULT_BACKOFF, ...options?.backoff }
		const timeoutMs = options?.deliveryTimeoutMs ?? DEFAULT_DELIVERY_TIMEOUT_MS
		let budget = options?.limit ?? 100
		const now = yield* Clock.currentTimeMillis
		const heads = yield* sql<RawOutboxRow>`SELECT ${sql.literal(COLUMNS)}
			FROM _outbox o JOIN (${sql.literal(HEADS)}) h ON o.rowid = h.head
			WHERE o.next_at <= ${now} ORDER BY o.rowid LIMIT ${budget}`
		const nextOf = (target: string) =>
			Effect.map(
				sql<RawOutboxRow>`SELECT ${sql.literal(COLUMNS)} FROM _outbox o
					WHERE o.status = 'pending' AND o.target = ${target} ORDER BY o.rowid LIMIT 1`,
				(rows) => rows[0],
			)
		const attempt = (outboxRow: OutboxRow) =>
			deliver(outboxRow).pipe(
				Effect.timeoutOrElse({
					duration: timeoutMs,
					orElse: () =>
						Effect.fail(
							new OutboxDeliveryError({ message: `Delivery timed out after ${timeoutMs}ms` }),
						),
				}),
				Effect.exit,
			)
		let delivered = 0
		let retried = 0
		let dead = 0
		for (const head of heads) {
			let row: RawOutboxRow | undefined = head
			// Walk this target's queue while rows are due and deliveries succeed (or go dead).
			while (row !== undefined && Number(row.next_at) <= now && budget > 0) {
				budget--
				const outboxRow: OutboxRow = {
					id: row.id,
					target: row.target,
					kind: row.kind,
					payload: JSON.parse(row.payload),
					attempts: Number(row.attempts),
					createdAt: Number(row.created_at),
				}
				const exit = yield* attempt(outboxRow)
				if (Exit.isSuccess(exit)) {
					yield* sql`DELETE FROM _outbox WHERE id = ${row.id}`
					delivered++
					row = yield* nextOf(row.target)
					continue
				}
				if (Cause.hasInterruptsOnly(exit.cause)) return yield* Effect.interrupt
				// Defects count as failed attempts too: the row must not be lost or retried hot.
				const error = Cause.findErrorOption(exit.cause)
				const message = Option.match(error, {
					onNone: () => Cause.pretty(exit.cause),
					onSome: (e) => e.message,
				}).slice(0, 2_000)
				const attempts = outboxRow.attempts + 1
				const retryable = Option.match(error, {
					onNone: () => true,
					onSome: (e) => e.retryable !== false,
				})
				const fields = { id: row.id, target: row.target, kind: row.kind, attempts, message }
				if (!retryable) {
					yield* sql`UPDATE _outbox SET status = 'dead', attempts = ${attempts}, last_error = ${message}
						WHERE id = ${row.id}`
					yield* Effect.logError("Outbox row is dead (non-retryable)", fields)
					dead++
					row = yield* nextOf(row.target)
					continue
				}
				const delay = backoffDelayMs(attempts, yield* Random.next, policy)
				yield* sql`UPDATE _outbox SET attempts = ${attempts}, next_at = ${now + delay}, last_error = ${message}
					WHERE id = ${row.id}`
				yield* Effect.logWarning("Outbox delivery failed; retrying", { ...fields, delayMs: delay })
				retried++
				row = undefined
			}
		}
		const nextAt = yield* nextOutboxAlarm
		yield* Effect.annotateCurrentSpan({
			"outbox.heads": heads.length,
			"outbox.delivered": delivered,
			"outbox.retried": retried,
			"outbox.dead": dead,
		})
		return { delivered, retried, dead, nextAt }
	}).pipe(Effect.withSpan("SyncDO.drainOutbox"))

/** A drainer bound to one object's delivery function; concurrent drains run one after another. */
export const makeOutbox = <R>(
	deliver: (row: OutboxRow) => Effect.Effect<void, OutboxDeliveryError, R>,
	options?: DrainOptions,
) => {
	const permit = Semaphore.makeUnsafe(1)
	return {
		enqueue,
		drain: permit.withPermit(drainOutbox(deliver, options)),
		/**
		 * Drain unless one is already running. A delivery that calls back into this object (A
		 * delivers to B, B's write delivers to A) would otherwise wait on the drain waiting on it;
		 * rows it adds are left to the alarm the running drain schedules.
		 */
		drainIfIdle: Effect.asVoid(permit.withPermitsIfAvailable(1)(drainOutbox(deliver, options))),
		nextAlarm: nextOutboxAlarm,
	}
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

export const INBOX_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Run `effect` once per `key`: inside a transaction (joining the caller's), skip if `key` was seen,
 * otherwise run it and record `key`. `None` means a duplicate.
 */
export const withInbox = <A, E, R>(
	key: string,
	effect: Effect.Effect<A, E, R>,
): Effect.Effect<Option.Option<A>, E | SqlError, R | SqlClient> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient
		return yield* sql.withTransaction(
			Effect.gen(function* () {
				const seen = yield* sql`SELECT 1 AS seen FROM _inbox WHERE key = ${key}`
				if (seen.length > 0) return Option.none<A>()
				const value = yield* effect
				const now = yield* Clock.currentTimeMillis
				yield* sql`INSERT INTO _inbox (key, at) VALUES (${key}, ${now})`
				return Option.some(value)
			}),
		)
	})

/** Forget inbox keys older than `maxAgeMs` (a sender retries far less long than that). */
export const pruneInbox = (maxAgeMs = INBOX_RETENTION_MS): Effect.Effect<void, SqlError, SqlClient> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient
		const now = yield* Clock.currentTimeMillis
		yield* sql`DELETE FROM _inbox WHERE at <= ${now - maxAgeMs}`
	})

/** When the oldest inbox key ages out, or `undefined` when the inbox is empty. */
export const nextInboxPruneAt = (
	maxAgeMs = INBOX_RETENTION_MS,
): Effect.Effect<number | undefined, SqlError, SqlClient> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient
		const rows = yield* sql<{ at: number | null }>`SELECT MIN(at) AS at FROM _inbox`
		const at = rows[0]?.at
		return at === null || at === undefined ? undefined : Number(at) + maxAgeMs
	})
