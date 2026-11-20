/**
 * Typed queries over the runtime's own tables (`_outbox`, `_inbox`, `_changes`, `_sync_meta`).
 * `run` executes on the object's effect `SqlClient`, so it joins the caller's transaction;
 * `execSync` on workerd's synchronous `ctx.storage.sql`, for the bookkeeping that runs outside
 * Effect. Their DDL stays with the code that installs them: these are query schemas only
 * (`external: true`).
 */
import * as Orm from "@maple-dev/effect-orm/database"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { Effect } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import type { SqlError } from "effect/sql/SqlError"
import type { SqlStorageLike, SqlValue } from "./sql-storage.ts"

export const outboxTable = SQLite.table("_outbox", {
	external: true,
	columns: {
		/** SQLite's implicit row id: the queue order. */
		rowid: SQLite.column(SQLite.integer, { defaultExpr: "(NULL)" }),
		id: SQLite.text,
		target: SQLite.text,
		kind: SQLite.text,
		payload: SQLite.text,
		attempts: SQLite.column(SQLite.integer, { default: 0 }),
		nextAt: SQLite.column(SQLite.integer, { name: "next_at" }),
		lastError: SQLite.column(SQLite.nullable(SQLite.text), { name: "last_error" }),
		createdAt: SQLite.column(SQLite.integer, { name: "created_at" }),
		status: SQLite.column(SQLite.text, { default: "pending" }),
	},
})

/** The change log (`./changes.ts`). */
export const changesTable = SQLite.table("_changes", {
	external: true,
	columns: {
		seq: SQLite.column(SQLite.integer, { defaultExpr: "(NULL)" }),
		tbl: SQLite.text,
		pk: SQLite.text,
		op: SQLite.text,
		at: SQLite.integer,
	},
})

/** Small persisted runtime state (`./sql-storage.ts`). */
export const syncMetaTable = SQLite.table("_sync_meta", {
	external: true,
	columns: {
		key: SQLite.text,
		value: SQLite.text,
	},
})

/** SQLite's own catalog. */
export const sqliteMasterTable = SQLite.table("sqlite_master", {
	external: true,
	columns: {
		type: SQLite.text,
		name: SQLite.text,
	},
})

export const inboxTable = SQLite.table("_inbox", {
	external: true,
	columns: {
		key: SQLite.text,
		at: SQLite.integer,
	},
})

/** What a store query can fail with. */
export type StoreError =
	| SqlError
	| Orm.DatabaseError
	| SQLite.QueryBuilderError
	| SQLite.CompiledQueryDecodeError

/** The `_tag`s of {@link StoreError}, for `catchTag`. */
export const STORE_ERROR_TAGS = [
	"SqlError",
	"@maple-dev/effect-orm/DatabaseError",
	"@maple-dev/effect-orm/QueryBuilderError",
	"@maple-dev/effect-orm/CompiledQueryDecodeError",
] as const satisfies ReadonlyArray<StoreError["_tag"]>

/** Runs a built query or write on the object's `SqlClient` and decodes its rows. */
export const run = <Q extends Orm.Runnable>(
	query: Q,
): Effect.Effect<ReadonlyArray<Orm.RowOf<Q>>, StoreError, SqlClient> =>
	Effect.flatMap(SqlClient, (sql) =>
		Orm.fromSqlClient(sql, { dialect: SQLite.sqliteDialect }).run(query as never),
	) as never

/**
 * Compiles a built query or write and runs it on workerd's synchronous storage, decoding its rows.
 * Throws as `exec` does: on a statement SQLite refuses, or a row that does not decode.
 */
export const execSync = <Q extends Orm.Runnable>(
	sql: SqlStorageLike,
	query: Q,
): ReadonlyArray<Orm.RowOf<Q>> => {
	const compiled = (SQLite.compileUnsafe as (query: unknown) => SQLite.CompiledQuery<Orm.RowOf<Q>>)(query)
	const rows = sql.exec(compiled.sql, ...(compiled.parameters as Array<SqlValue>)).toArray()
	return Effect.runSync(compiled.decodeRows(rows))
}
