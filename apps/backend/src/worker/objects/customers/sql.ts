/**
 * Durable Object SQLite binds at most 100 parameters per statement: id lists travel as one JSON
 * parameter, and multi-row inserts are chunked to fit.
 */
import { SQLite } from "@hazel/db"

/** `column IN (…values)` with the values as one JSON parameter. */
export const inList = <A>(column: SQLite.Expr<A, never>, values: ReadonlyArray<string>) =>
	SQLite.sql.cond`${column} IN (SELECT value FROM json_each(${JSON.stringify(values)}))`

/** Rows per multi-row insert of a table with `columns` columns. */
export const rowsPerInsert = (columns: number) => Math.max(1, Math.floor(100 / columns))
