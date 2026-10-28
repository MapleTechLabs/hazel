/**
 * The query builder for Hazel's databases (DO SQLite and D1): `@maple-dev/effect-orm/sqlite`,
 * plus the few functions it has no SQLite form of. Imported as `SQLite` from `@hazel/db`.
 */
import * as SQLite from "@maple-dev/effect-orm/sqlite"

export * from "@maple-dev/effect-orm/sqlite"

const nullableText = SQLite.nullable(SQLite.text)

/**
 * A JSON object's field as text, NULL when it is absent (Postgres's `->>`). Cast, because
 * `json_extract` returns a number field as a number, which never equals its text.
 */
export const jsonText = <P = never>(
	expr: SQLite.Expr<unknown, P>,
	key: string,
): SQLite.Expr<string | null, P> =>
	SQLite.sql(nullableText)`CAST(json_extract(${expr}, ${`$.${key}`}) AS TEXT)` as SQLite.Expr<
		string | null,
		P
	>

/** The larger of two values (`greatest`); SQLite's two-argument `max`, NULL when either is. */
export const greatest = <A, P = never>(
	first: SQLite.Expr<A, P>,
	second: SQLite.Expr<A, P>,
): SQLite.Expr<A, P> =>
	SQLite.sql({ schema: SQLite.schemaOf<A>(first) } as never)`max(${first}, ${second})` as SQLite.Expr<A, P>

/** `CASE WHEN c1 THEN v1 ... ELSE otherwise END`, decoding as `otherwise` does. */
export const caseWhen = <A, P = never>(
	branches: ReadonlyArray<readonly [SQLite.Condition<P>, SQLite.Expr<A, P>]>,
	otherwise: SQLite.Expr<A, P>,
): SQLite.Expr<A, P> =>
	SQLite.sql({ schema: SQLite.schemaOf<A>(otherwise) } as never)`CASE ${SQLite.sql.join(
		branches.map(([when, then]) => SQLite.sql`WHEN ${when} THEN ${then}`),
		" ",
	)} ELSE ${otherwise} END` as SQLite.Expr<A, P>
