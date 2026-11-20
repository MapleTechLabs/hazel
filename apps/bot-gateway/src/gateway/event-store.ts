/**
 * The append-only event log in the `BotGateway` object's SQLite storage. Written against the
 * synchronous subset of workerd's `SqlStorage` the object uses, so tests can back it with any
 * SQLite. Every function runs synchronously, so inside the object each call is atomic.
 */
import { SQLite } from "@hazel/db"
import type { LogBounds, RetentionPolicy, Seq, StoredEvent } from "./log.ts"

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
 * comparing within a region. Each event also has its region's own sequence number (`rseq`, the
 * region's head in `bot_gateway_meta` under `region_head:<region>`), which bounds a region's
 * backlog with one indexed delete. Existing events are the default region's, numbered as before.
 */
const SCHEMA_V2 = [
	`ALTER TABLE bot_gateway_events ADD COLUMN region TEXT NOT NULL DEFAULT ''`,
	`ALTER TABLE bot_gateway_events ADD COLUMN rseq INTEGER NOT NULL DEFAULT 0`,
	`UPDATE bot_gateway_events SET rseq = seq`,
	`INSERT INTO bot_gateway_meta (key, value)
		SELECT 'region_head:', value FROM bot_gateway_meta WHERE key = 'head'
		ON CONFLICT (key) DO NOTHING`,
	`CREATE INDEX IF NOT EXISTS bot_gateway_events_region_seq ON bot_gateway_events (region, seq)`,
	`CREATE INDEX IF NOT EXISTS bot_gateway_events_region_rseq ON bot_gateway_events (region, rseq)`,
]

const REGION_HEAD_PREFIX = "region_head:"

// Query schemas of the tables above (their DDL is `SCHEMA_V1` / `SCHEMA_V2`).
const eventsTable = SQLite.table("bot_gateway_events", {
	external: true,
	columns: {
		seq: SQLite.integer,
		body: SQLite.text,
		appendedAt: SQLite.column(SQLite.integer, { name: "appended_at" }),
		region: SQLite.text,
		rseq: SQLite.integer,
	},
})

const metaTable = SQLite.table("bot_gateway_meta", {
	external: true,
	columns: {
		key: SQLite.text,
		value: SQLite.integer,
	},
})

/**
 * Bring the object's storage to {@link SCHEMA_VERSION}. Every activation runs it; the statements
 * between two awaits commit together in a Durable Object, so a version is applied whole or not.
 */
export const migrate = (sql: SqlStorageLike): void => {
	for (const statement of SCHEMA_V1) sql.exec(statement)
	const version = SQLite.runSync(sql, metaValue("schema"))[0]?.value ?? 1
	if (version >= SCHEMA_VERSION) return
	for (const statement of SCHEMA_V2) sql.exec(statement)
	writeMeta(sql, "schema", SCHEMA_VERSION)
}

const metaValue = (key: string) =>
	SQLite.from(metaTable)
		.select("value")
		.where(($) => [$.key.eq(key)])

const readMeta = (sql: SqlStorageLike, key: string): number =>
	SQLite.runSync(sql, metaValue(key))[0]?.value ?? 0

const writeMeta = (sql: SqlStorageLike, key: string, value: number): void => {
	SQLite.runSync(
		sql,
		SQLite.insertInto(metaTable)
			.values({ key, value })
			.onConflictDoUpdate({ target: ["key"], set: SQLite.excluded(["value"]) }),
	)
}

const readHead = (sql: SqlStorageLike): Seq => readMeta(sql, "head")

/** The log's extent as `region`'s session sees it: the global head, its own oldest event. */
export const bounds = (sql: SqlStorageLike, region: string = DEFAULT_REGION): LogBounds => {
	const first = SQLite.runSync(
		sql,
		SQLite.from(eventsTable)
			.select(($) => ({ first: SQLite.min($.seq) }))
			.where(($) => [$.region.eq(region)]),
	)[0]?.first
	return { head: readHead(sql), firstRetained: first ?? undefined }
}

/** Append one event for `region`'s session; returns its sequence number. */
export const append = (
	sql: SqlStorageLike,
	body: string,
	appendedAt: number,
	region: string = DEFAULT_REGION,
): Seq => {
	const seq = readHead(sql) + 1
	const regionKey = `${REGION_HEAD_PREFIX}${region}`
	const rseq = readMeta(sql, regionKey) + 1
	SQLite.runSync(sql, SQLite.insertInto(eventsTable).values({ seq, body, appendedAt, region, rseq }))
	writeMeta(sql, "head", seq)
	writeMeta(sql, regionKey, rseq)
	return seq
}

/** Up to `limit` of `region`'s events after `cursor`, in log order. */
export const readAfter = (
	sql: SqlStorageLike,
	cursor: Seq,
	limit: number,
	region: string = DEFAULT_REGION,
): ReadonlyArray<StoredEvent> =>
	SQLite.runSync(
		sql,
		SQLite.from(eventsTable)
			.select("seq", "body")
			.where(($) => [$.region.eq(region), $.seq.gt(cursor)])
			.orderBy(["seq", "asc"])
			.limit(limit),
	)

/** Drop every event of `region` at or before `seq` (its session acknowledged them). */
export const trimThrough = (sql: SqlStorageLike, seq: Seq, region: string = DEFAULT_REGION): void => {
	SQLite.runSync(
		sql,
		SQLite.deleteFrom(eventsTable).where(($) => [$.region.eq(region), $.seq.lte(seq)]),
	)
}

/**
 * Drop events past the retention policy's limits. The count is per region: each region keeps its
 * newest `maxEvents`, so one region's traffic never evicts another's undelivered events. The age
 * limit is per event, whatever its region.
 */
export const enforceRetention = (sql: SqlStorageLike, now: number, policy: RetentionPolicy): void => {
	const heads = SQLite.runSync(
		sql,
		SQLite.from(metaTable)
			.select("key", "value")
			.where(($) => [$.key.startsWith(REGION_HEAD_PREFIX)]),
	)
	for (const { key, value } of heads) {
		// A region's events numbered at or below its head minus `maxEvents` are past its limit.
		const floor = value - policy.maxEvents
		if (floor > 0) {
			const region = key.slice(REGION_HEAD_PREFIX.length)
			SQLite.runSync(
				sql,
				SQLite.deleteFrom(eventsTable).where(($) => [$.region.eq(region), $.rseq.lte(floor)]),
			)
		}
	}
	SQLite.runSync(
		sql,
		SQLite.deleteFrom(eventsTable).where(($) => [$.appendedAt.lte(now - policy.maxAgeMs)]),
	)
}

export const oldestAppendedAt = (sql: SqlStorageLike): number | undefined => {
	const oldest = SQLite.runSync(
		sql,
		SQLite.from(eventsTable).select(($) => ({ oldest: SQLite.min($.appendedAt) })),
	)[0]?.oldest
	return oldest ?? undefined
}
