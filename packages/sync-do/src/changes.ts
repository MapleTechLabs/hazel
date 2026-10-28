/**
 * The `_changes` log: `AFTER INSERT/UPDATE/DELETE` triggers on every tracked table record
 * `(tbl, pk, op)`, so repository code needs no changes to be tracked. `seq` is AUTOINCREMENT, so it
 * is never reused, even after pruning.
 */
import {
	installMeta,
	quoteIdent,
	readMeta,
	readMetaNumber,
	type SqlStorageLike,
	writeMeta,
} from "./sql-storage.ts"

export type ChangeOp = "insert" | "update" | "delete"

export interface Change {
	readonly tbl: string
	/** The row's key columns joined with `:`. */
	readonly pk: string
	readonly op: ChangeOp
}

export interface TrackedTable {
	readonly name: string
	readonly key: ReadonlyArray<string>
}

export interface RetentionPolicy {
	/** Keep at least this many of the newest changes. */
	readonly keepLatest: number
	/** Drop changes older than this (beyond `keepLatest`). */
	readonly maxAgeMs: number
}

export const DEFAULT_RETENTION: RetentionPolicy = { keepLatest: 50_000, maxAgeMs: 7 * 24 * 60 * 60 * 1000 }

/** Bump when the trigger SQL changes, so existing objects recreate their triggers. */
const TRIGGER_VERSION = 1
const SIGNATURE_KEY = "changes.signature"
/** Every change at or below this seq was pruned; a `since` below it cannot catch up. */
const FLOOR_KEY = "changes.floor"

const NOW_MS = `CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)`

const CHANGES_TABLE = `CREATE TABLE IF NOT EXISTS _changes (
	seq INTEGER PRIMARY KEY AUTOINCREMENT,
	tbl TEXT NOT NULL,
	pk TEXT NOT NULL,
	op TEXT NOT NULL,
	at INTEGER NOT NULL
)`

const triggerNames = (table: string) =>
	(["ins", "upd", "del"] as const).map((suffix) => `_sync_${table}_${suffix}`)

const pkExpr = (row: "NEW" | "OLD", key: ReadonlyArray<string>) =>
	key.map((column) => `CAST(${row}.${quoteIdent(column)} AS TEXT)`).join(` || ':' || `)

const literal = (value: string) => `'${value.replaceAll("'", "''")}'`

const triggerStatements = ({ name, key }: TrackedTable): ReadonlyArray<string> => {
	const [ins, upd, del] = triggerNames(name).map(quoteIdent)
	const table = quoteIdent(name)
	const tbl = literal(name)
	const oldPk = pkExpr("OLD", key)
	const newPk = pkExpr("NEW", key)
	return [
		`CREATE TRIGGER ${ins} AFTER INSERT ON ${table} BEGIN
			INSERT INTO _changes (tbl, pk, op, at) VALUES (${tbl}, ${newPk}, 'insert', ${NOW_MS});
		END`,
		// A key change is a delete of the old key and an insert of the new one.
		`CREATE TRIGGER ${upd} AFTER UPDATE ON ${table} BEGIN
			INSERT INTO _changes (tbl, pk, op, at)
				SELECT ${tbl}, ${oldPk}, 'delete', ${NOW_MS} WHERE (${oldPk}) IS NOT (${newPk});
			INSERT INTO _changes (tbl, pk, op, at) VALUES (
				${tbl}, ${newPk}, CASE WHEN (${oldPk}) IS (${newPk}) THEN 'update' ELSE 'insert' END, ${NOW_MS}
			);
		END`,
		`CREATE TRIGGER ${del} AFTER DELETE ON ${table} BEGIN
			INSERT INTO _changes (tbl, pk, op, at) VALUES (${tbl}, ${oldPk}, 'delete', ${NOW_MS});
		END`,
	]
}

const signatureOf = (tables: ReadonlyArray<TrackedTable>) =>
	JSON.stringify({
		v: TRIGGER_VERSION,
		tables: [...tables]
			.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
			.map(({ name, key }) => ({ name, key })),
	})

/**
 * Create `_changes` and the triggers. Idempotent and cheap when nothing changed; when the table or
 * key set differs from the installed one, every previous trigger is dropped and recreated. The
 * tracked tables must already exist.
 */
export const installChangeTracking = (sql: SqlStorageLike, tables: ReadonlyArray<TrackedTable>): void => {
	installMeta(sql)
	sql.exec(CHANGES_TABLE)
	sql.exec(`CREATE INDEX IF NOT EXISTS _changes_at ON _changes (at)`)
	const signature = signatureOf(tables)
	const installed = readMeta(sql, SIGNATURE_KEY)
	if (installed === signature) return

	if (installed !== undefined) {
		const previous = JSON.parse(installed) as { tables: ReadonlyArray<TrackedTable> }
		for (const table of previous.tables) {
			for (const trigger of triggerNames(table.name))
				sql.exec(`DROP TRIGGER IF EXISTS ${quoteIdent(trigger)}`)
		}
	}
	for (const table of tables) {
		if (table.key.length === 0) throw new Error(`Tracked table ${table.name} has no key columns`)
		for (const trigger of triggerNames(table.name))
			sql.exec(`DROP TRIGGER IF EXISTS ${quoteIdent(trigger)}`)
		for (const statement of triggerStatements(table)) sql.exec(statement)
	}
	writeMeta(sql, SIGNATURE_KEY, signature)
}

/** The lowest `since` that can still catch up: every change after it is retained. */
export const oldestSeq = (sql: SqlStorageLike): number => readMetaNumber(sql, FLOOR_KEY)

/** The newest change's seq (0 before the first change). */
export const headSeq = (sql: SqlStorageLike): number => {
	const row = sql.exec<{ head: number | null }>(`SELECT MAX(seq) AS head FROM _changes`).toArray()[0]
	const head = row?.head
	return Math.max(head === null || head === undefined ? 0 : Number(head), oldestSeq(sql))
}

export interface ChangeBatch {
	/** The last seq read (equal to `after` when nothing was). */
	readonly through: number
	/** Number of raw log rows read; equal to `limit` when more may follow. */
	readonly read: number
	/** Coalesced per `(tbl, pk)`, latest op wins, in order of each key's latest change. */
	readonly changes: ReadonlyArray<Change>
}

/** Up to `limit` raw changes after `after`, coalesced. */
export const readChanges = (sql: SqlStorageLike, after: number, limit: number): ChangeBatch => {
	const rows = sql
		.exec<{ seq: number; tbl: string; pk: string; op: string }>(
			`SELECT seq, tbl, pk, op FROM _changes WHERE seq > ? ORDER BY seq LIMIT ?`,
			after,
			limit,
		)
		.toArray()
	const latest = new Map<string, Change>()
	for (const row of rows) {
		const id = `${row.tbl}\u0000${row.pk}`
		latest.delete(id)
		latest.set(id, { tbl: String(row.tbl), pk: String(row.pk), op: String(row.op) as ChangeOp })
	}
	const last = rows[rows.length - 1]
	return {
		through: last === undefined ? after : Number(last.seq),
		read: rows.length,
		changes: [...latest.values()],
	}
}

export interface PruneOptions extends Partial<RetentionPolicy> {
	readonly now: number
	/** Never prune past this seq (the runtime passes its flush cursor). */
	readonly notAfter?: number
}

/** Drop changes beyond the retention policy; returns the new floor (see `oldestSeq`). */
export const pruneChanges = (sql: SqlStorageLike, options: PruneOptions): number => {
	const keepLatest = options.keepLatest ?? DEFAULT_RETENTION.keepLatest
	const maxAgeMs = options.maxAgeMs ?? DEFAULT_RETENTION.maxAgeMs
	const floor = oldestSeq(sql)
	const head = headSeq(sql)
	const aged = sql
		.exec<{ seq: number | null }>(
			`SELECT MAX(seq) AS seq FROM _changes WHERE at <= ?`,
			options.now - maxAgeMs,
		)
		.toArray()[0]?.seq
	const cut = Math.min(
		Math.max(head - keepLatest, aged === null || aged === undefined ? 0 : Number(aged)),
		options.notAfter ?? head,
	)
	if (cut <= floor) return floor
	sql.exec(`DELETE FROM _changes WHERE seq <= ?`, cut)
	writeMeta(sql, FLOOR_KEY, String(cut))
	return cut
}

/** When the oldest retained change ages out, or `undefined` when the log is empty. */
export const nextChangePruneAt = (
	sql: SqlStorageLike,
	maxAgeMs = DEFAULT_RETENTION.maxAgeMs,
): number | undefined => {
	const row = sql.exec<{ at: number | null }>(`SELECT MIN(at) AS at FROM _changes`).toArray()[0]
	const at = row?.at
	return at === null || at === undefined ? undefined : Number(at) + maxAgeMs
}
