/**
 * Test helper: the schema an SQLite database holds, compared structurally. `ALTER TABLE ... ADD
 * COLUMN` appends to the stored `CREATE TABLE` text, so the text of a migrated table differs from a
 * fresh one even when the tables are the same.
 */
import { Effect } from "effect"
import * as SqlClient from "effect/sql/SqlClient"

interface ColumnInfo {
	readonly name: string
	readonly type: string
	readonly notnull: number
	readonly dflt_value: string | null
	readonly pk: number
}

export const structuralSchema = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient
	const tables = yield* sql<{ readonly name: string }>`
		SELECT name FROM sqlite_master
		WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '_migrations' ORDER BY name`
	const result: Record<string, unknown> = {}
	for (const { name } of tables) {
		const columns = yield* sql.unsafe<ColumnInfo>(`PRAGMA table_info("${name}")`)
		const uniques = yield* sql.unsafe<{ readonly name: string; readonly origin: string }>(
			`PRAGMA index_list("${name}")`,
		)
		const constraints: Array<ReadonlyArray<string>> = []
		for (const index of uniques.filter((index) => index.origin === "u")) {
			const parts = yield* sql.unsafe<{ readonly name: string }>(`PRAGMA index_info("${index.name}")`)
			constraints.push(parts.map((part) => part.name))
		}
		result[name] = {
			columns: [...columns]
				.sort((a, b) => a.name.localeCompare(b.name))
				.map(({ name, type, notnull, dflt_value, pk }) => ({ name, type, notnull, dflt_value, pk })),
			uniques: constraints.map((columns) => columns.join(",")).sort(),
		}
	}
	const indexes = yield* sql<{ readonly name: string; readonly sql: string }>`
		SELECT name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name`
	result["(indexes)"] = indexes.map((index) => index.sql.replace(/ IF NOT EXISTS/i, ""))
	return result
})
