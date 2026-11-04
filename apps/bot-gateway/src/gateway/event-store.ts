/**
 * The append-only event log in the `BotGateway` object's SQLite storage. Written against the
 * synchronous subset of workerd's `SqlStorage` the object uses, so tests can back it with any
 * SQLite. Every function runs synchronously, so inside the object each call is atomic.
 */
import { type LogBounds, type RetentionPolicy, retentionFloor, type Seq, type StoredEvent } from "./log.ts"

type SqlValue = string | number | null | ArrayBuffer

export interface SqlCursorLike<T> {
	toArray(): T[]
}

/** The part of workerd's `ctx.storage.sql` this store needs. */
export interface SqlStorageLike {
	exec<T extends Record<string, SqlValue>>(query: string, ...bindings: Array<SqlValue>): SqlCursorLike<T>
}

/** The session region of an install nobody routed elsewhere (`BotGatewayRegion` omitted). */
export const DEFAULT_REGION = ""

const SCHEMA_VERSION = 2

const SCHEMA_V1 = [
	`CREATE TABLE IF NOT EXISTS bot_gateway_events (
		seq INTEGER PRIMARY KEY,
		body TEXT NOT NULL,
		appended_at INTEGER NOT NULL
	)`,
	// `head` survives trimming, so sequence numbers are never reused.
	`CREATE TABLE IF NOT EXISTS bot_gateway_meta (
		key TEXT PRIMARY KEY,
		value INTEGER NOT NULL
	)`,
]

/**
 * v2: one log, read per region. Each event carries the region whose session receives it, as its
 * publisher named it (the default one is `''`). Sequence numbers stay global, so offsets keep
 * comparing within a region.
 */
const SCHEMA_V2 = [
	`ALTER TABLE bot_gateway_events ADD COLUMN region TEXT NOT NULL DEFAULT ''`,
	`CREATE INDEX IF NOT EXISTS bot_gateway_events_region_seq ON bot_gateway_events (region, seq)`,
]

/**
 * Bring the object's storage to {@link SCHEMA_VERSION}. Every activation runs it; the statements
 * between two awaits commit together in a Durable Object, so a version is applied whole or not.
 */
export const migrate = (sql: SqlStorageLike): void => {
	for (const statement of SCHEMA_V1) sql.exec(statement)
	const row = sql
		.exec<{ value: number }>(`SELECT value FROM bot_gateway_meta WHERE key = 'schema'`)
		.toArray()[0]
	const version = row === undefined ? 1 : Number(row.value)
	if (version >= SCHEMA_VERSION) return
	for (const statement of SCHEMA_V2) sql.exec(statement)
	sql.exec(
		`INSERT INTO bot_gateway_meta (key, value) VALUES ('schema', ?)
		ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
		SCHEMA_VERSION,
	)
}

const readHead = (sql: SqlStorageLike): Seq => {
	const row = sql
		.exec<{ value: number }>(`SELECT value FROM bot_gateway_meta WHERE key = 'head'`)
		.toArray()[0]
	return row === undefined ? 0 : Number(row.value)
}

/** The log's extent as `region`'s session sees it: the global head, its own oldest event. */
export const bounds = (sql: SqlStorageLike, region: string = DEFAULT_REGION): LogBounds => {
	const row = sql
		.exec<{ first: number | null }>(
			`SELECT MIN(seq) AS first FROM bot_gateway_events WHERE region = ?`,
			region,
		)
		.toArray()[0]
	const first = row?.first
	return {
		head: readHead(sql),
		firstRetained: first === null || first === undefined ? undefined : Number(first),
	}
}

/** Append one event for `region`'s session; returns its sequence number. */
export const append = (
	sql: SqlStorageLike,
	body: string,
	appendedAt: number,
	region: string = DEFAULT_REGION,
): Seq => {
	const seq = readHead(sql) + 1
	sql.exec(
		`INSERT INTO bot_gateway_events (seq, body, appended_at, region) VALUES (?, ?, ?, ?)`,
		seq,
		body,
		appendedAt,
		region,
	)
	sql.exec(
		`INSERT INTO bot_gateway_meta (key, value) VALUES ('head', ?)
		ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
		seq,
	)
	return seq
}

/** Up to `limit` of `region`'s events after `cursor`, in log order. */
export const readAfter = (
	sql: SqlStorageLike,
	cursor: Seq,
	limit: number,
	region: string = DEFAULT_REGION,
): ReadonlyArray<StoredEvent> =>
	sql
		.exec<{ seq: number; body: string }>(
			`SELECT seq, body FROM bot_gateway_events WHERE region = ? AND seq > ? ORDER BY seq LIMIT ?`,
			region,
			cursor,
			limit,
		)
		.toArray()
		.map((row) => ({ seq: Number(row.seq), body: String(row.body) }))

/** Drop every event of `region` at or before `seq` (its session acknowledged them). */
export const trimThrough = (sql: SqlStorageLike, seq: Seq, region: string = DEFAULT_REGION): void => {
	sql.exec(`DELETE FROM bot_gateway_events WHERE region = ? AND seq <= ?`, region, seq)
}

/** Drop events past the retention policy's count and age limits. */
export const enforceRetention = (sql: SqlStorageLike, now: number, policy: RetentionPolicy): void => {
	const floor = retentionFloor(readHead(sql), policy)
	if (floor > 0) sql.exec(`DELETE FROM bot_gateway_events WHERE seq <= ?`, floor)
	sql.exec(`DELETE FROM bot_gateway_events WHERE appended_at <= ?`, now - policy.maxAgeMs)
}

export const oldestAppendedAt = (sql: SqlStorageLike): number | undefined => {
	const row = sql
		.exec<{ oldest: number | null }>(`SELECT MIN(appended_at) AS oldest FROM bot_gateway_events`)
		.toArray()[0]
	const oldest = row?.oldest
	return oldest === null || oldest === undefined ? undefined : Number(oldest)
}
