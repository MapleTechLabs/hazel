/**
 * Durable Object SQLite binds at most 100 parameters per statement: id lists travel as one JSON
 * parameter (`json_each`), and multi-row inserts are chunked to fit.
 */
import { SQLite } from "@hazel/db"

/** `values` as a one-column query (`SELECT value FROM json_each(?)`), bound as one parameter. */
export const valuesOf = (values: ReadonlyArray<string>) =>
	SQLite.from(SQLite.jsonEach(values, { value: SQLite.text })).select(($) => ({ value: $.value }))

/** `column IN (…values)` with the values as one JSON parameter. */
export const inList = <A extends string, P>(
	column: SQLite.Expr<A | null, P>,
	values: ReadonlyArray<A>,
): SQLite.Condition<P | SQLite.SqliteOnly> => {
	const text: SQLite.Expr<string | null, P> = column
	return SQLite.inSubquery(text, valuesOf(values))
}

/** An activity day that counts as active (`customer_activity_daily`). */
export const isActive = <P>($: {
	readonly eventCount: SQLite.Expr<number, P>
	readonly sessionCount: SQLite.Expr<number, P>
	readonly signedIn: SQLite.Expr<boolean, P>
}) => $.eventCount.gt(0).or($.sessionCount.gt(0)).or($.signedIn.eq(true))

/** Rows per multi-row insert of a table with `columns` columns. */
export const rowsPerInsert = (columns: number) => Math.max(1, Math.floor(100 / columns))
