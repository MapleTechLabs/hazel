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

const SCHEMA = [
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

export const migrate = (sql: SqlStorageLike): void => {
	for (const statement of SCHEMA) sql.exec(statement)
}

const readHead = (sql: SqlStorageLike): Seq => {
	const row = sql
		.exec<{ value: number }>(`SELECT value FROM bot_gateway_meta WHERE key = 'head'`)
		.toArray()[0]
	return row === undefined ? 0 : Number(row.value)
}

export const bounds = (sql: SqlStorageLike): LogBounds => {
	const row = sql
		.exec<{ first: number | null }>(`SELECT MIN(seq) AS first FROM bot_gateway_events`)
		.toArray()[0]
	const first = row?.first
	return {
		head: readHead(sql),
		firstRetained: first === null || first === undefined ? undefined : Number(first),
	}
}

/** Append one event; returns its sequence number. */
export const append = (sql: SqlStorageLike, body: string, appendedAt: number): Seq => {
	const seq = readHead(sql) + 1
	sql.exec(
		`INSERT INTO bot_gateway_events (seq, body, appended_at) VALUES (?, ?, ?)`,
		seq,
		body,
		appendedAt,
	)
	sql.exec(
		`INSERT INTO bot_gateway_meta (key, value) VALUES ('head', ?)
		ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
		seq,
	)
	return seq
}

/** Up to `limit` events after `cursor`, in log order. */
export const readAfter = (sql: SqlStorageLike, cursor: Seq, limit: number): ReadonlyArray<StoredEvent> =>
	sql
		.exec<{ seq: number; body: string }>(
			`SELECT seq, body FROM bot_gateway_events WHERE seq > ? ORDER BY seq LIMIT ?`,
			cursor,
			limit,
		)
		.toArray()
		.map((row) => ({ seq: Number(row.seq), body: String(row.body) }))

/** Drop every event at or before `seq` (it has been acknowledged). */
export const trimThrough = (sql: SqlStorageLike, seq: Seq): void => {
	sql.exec(`DELETE FROM bot_gateway_events WHERE seq <= ?`, seq)
}

/** Drop events past the retention policy's count and age limits. */
export const enforceRetention = (sql: SqlStorageLike, now: number, policy: RetentionPolicy): void => {
	const floor = retentionFloor(readHead(sql), policy)
	if (floor > 0) trimThrough(sql, floor)
	sql.exec(`DELETE FROM bot_gateway_events WHERE appended_at <= ?`, now - policy.maxAgeMs)
}

export const oldestAppendedAt = (sql: SqlStorageLike): number | undefined => {
	const row = sql
		.exec<{ oldest: number | null }>(`SELECT MIN(appended_at) AS oldest FROM bot_gateway_events`)
		.toArray()[0]
	const oldest = row?.oldest
	return oldest === null || oldest === undefined ? undefined : Number(oldest)
}
