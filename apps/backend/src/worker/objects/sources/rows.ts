/**
 * Building blocks for the objects' sync sources: a streamed table over an effect-orm table and a
 * per-principal visibility condition over the object's local SQLite.
 *
 * Rows go out in the shape the client models (`@hazel/domain/models` `*.Schema`) decode
 * unchanged: column names as keys, timestamps as ISO strings, JSON columns parsed, booleans as
 * booleans.
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
		lt(value: unknown): SQLite.Condition
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
	return {
		name: spec.table.name,
		key,
		...(spec.dependsOn === undefined ? {} : { dependsOn: spec.dependsOn }),
		...(spec.affectedPrincipals === undefined ? {} : { affectedPrincipals: spec.affectedPrincipals }),
		load: (principal, keys) =>
			keys !== "all" && keys.length === 0
				? Effect.succeed([])
				: selectVisible(spec, principal, ($) =>
						keys === "all" ? undefined : byKeys(key, $, keys),
					).pipe(Effect.withSpan("SyncDO.load", { attributes: { "sync.table": spec.table.name } })),
	}
}

/** Ordering and limit for {@link selectVisible}. */
export interface SelectWindow {
	readonly orderBy: ($: ColumnAccessors) => ReadonlyArray<readonly [SQLite.Expr<any>, "asc" | "desc"]>
	readonly limit: number
}

/** The rows of `spec` that `principal` may see and `extra` matches, as sync rows. Failures are defects. */
export const selectVisible = <P>(
	spec: SyncTableSpec<P>,
	principal: P,
	extra: ($: ColumnAccessors) => SQLite.Condition | undefined,
	window?: SelectWindow,
): Effect.Effect<ReadonlyArray<SyncRow>, never, Database.Database> =>
	Effect.gen(function* () {
		const key = spec.key ?? ["id"]
		const db = yield* Database.Database
		const where = SQLite.from(spec.table)
			.select()
			.where((columns: unknown) => {
				const $ = columns as ColumnAccessors
				return [...spec.visible(principal, $), extra($)] as never
			}) as any
		const query =
			window === undefined
				? where
				: where
						.orderBy((columns: unknown) => window.orderBy(columns as ColumnAccessors))
						.limit(window.limit)
		const rows = yield* db.run(query as never)
		return (rows as ReadonlyArray<Record<string, unknown>>).map((row): SyncRow => ({
			key: key.map((column) => String(row[column])).join(":"),
			row: toWireRow(row),
		}))
	}).pipe(Effect.orDie)

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
