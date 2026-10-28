/**
 * Building blocks for the objects' sync sources: a streamed table over an effect-orm table and a
 * per-principal visibility condition (the WHERE clauses the Electric proxy used, ported to the
 * object's local SQLite).
 *
 * Rows go out the way Electric sent them, so the client models (`@hazel/domain/models`
 * `*.Schema`) decode them unchanged: column names as keys, timestamps as ISO strings, JSON
 * columns parsed, booleans as booleans.
 */
import { Database, SQLite } from "@hazel/db"
import type { Change, SyncRow, SyncTable } from "@hazel/sync-do"
import { Effect } from "effect"

type AnyTable = SQLite.Table<string, any, any, any>

/** The column accessors a visibility condition reads (`$.deletedAt.isNull()`, `${$.id}`). */
export interface ColumnAccessors {
	readonly [column: string]: SQLite.Expr<any> & {
		isNull(): SQLite.Condition
		eq(value: unknown): SQLite.Condition
		in_(...values: Array<any>): SQLite.Condition
	}
}

/** A decoded row as wire JSON: `Date`s become ISO strings, everything else is already JSON. */
export const toWireRow = (row: Record<string, unknown>): Record<string, unknown> => {
	const out: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(row))
		out[key] = value instanceof Date ? value.toISOString() : value
	return out
}

export interface SyncTableSpec<P> {
	readonly table: AnyTable
	/** Key columns, joined with `:` (the `_changes.pk` form). Defaults to `["id"]`. */
	readonly key?: ReadonlyArray<string>
	/** The rows `principal` may see. `undefined` entries are skipped (`SQLite.when`). */
	readonly visible: (principal: P, $: ColumnAccessors) => ReadonlyArray<SQLite.Condition | undefined>
	readonly dependsOn?: ReadonlyArray<string>
	readonly affectedPrincipals?: (changes: ReadonlyArray<Change>) => ReadonlyArray<string> | "all"
}

/**
 * A streamed table: loads the visible rows (all, or those among `keys`) through the object's
 * `Database`. A failed read is a defect; the runtime closes the principal's sockets with 1011 and
 * the client resnapshots.
 */
export const syncTable = <P>(spec: SyncTableSpec<P>): SyncTable<P, never, Database.Database> => {
	const key = spec.key ?? ["id"]
	const keyOf = (row: Record<string, unknown>) => key.map((column) => String(row[column])).join(":")
	return {
		name: spec.table.name,
		key,
		...(spec.dependsOn === undefined ? {} : { dependsOn: spec.dependsOn }),
		...(spec.affectedPrincipals === undefined ? {} : { affectedPrincipals: spec.affectedPrincipals }),
		load: (principal, keys) =>
			Effect.gen(function* () {
				if (keys !== "all" && keys.length === 0) return []
				const db = yield* Database.Database
				const rows = yield* db.run(
					SQLite.from(spec.table)
						.select()
						.where((columns: unknown) => {
							const $ = columns as ColumnAccessors
							return [
								...spec.visible(principal, $),
								keys === "all" ? undefined : byKeys(key, $, keys),
							] as never
						}) as never,
				)
				return (rows as ReadonlyArray<Record<string, unknown>>).map(
					(row): SyncRow => ({ key: keyOf(row), row: toWireRow(row) }),
				)
			}).pipe(
				Effect.orDie,
				Effect.withSpan("SyncDO.load", { attributes: { "sync.table": spec.table.name } }),
			),
	}
}

/** `key IN (keys)`; a composite key matches `col1 || ':' || col2`. */
const byKeys = (key: ReadonlyArray<string>, $: ColumnAccessors, keys: ReadonlyArray<string>) => {
	if (key.length === 1) return $[key[0]!]!.in_(...keys)
	const joined = SQLite.sql.join(
		key.map((column) => $[column]!),
		` || ':' || `,
	)
	return SQLite.sql.cond`(${joined}) IN (${SQLite.sql.join(keys)})`
}

/** The user ids in `channel_access` (or `channel_viewers`) changes: the key's first column. */
export const userIdsOf = (changes: ReadonlyArray<Change>): ReadonlyArray<string> => [
	...new Set(changes.map((change) => change.pk.split(":")[0]!)),
]
