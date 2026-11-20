/**
 * Typed queries over the runtime's own tables (`_outbox`, `_inbox`), run on the object's effect
 * `SqlClient`, so they join the caller's transaction. Their DDL stays in `outbox.ts`: these are
 * query schemas only (`external: true`).
 */
import * as Orm from "@maple-dev/effect-orm/database"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { Effect } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import type { SqlError } from "effect/sql/SqlError"

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
