/**
 * The query builder for Hazel's databases (DO SQLite and D1): `@maple-dev/effect-orm/sqlite`,
 * plus Hazel's own shorthands over it. Imported as `SQLite` from `@hazel/db`.
 */
import * as SQLite from "@maple-dev/effect-orm/sqlite"

export * from "@maple-dev/effect-orm/sqlite"

const nullableText = SQLite.nullable(SQLite.text)

/**
 * A JSON object's field as text, NULL when it is absent. Cast, because `json_extract` returns a
 * number field as a number, which never equals its text. The expression the
 * `int_conn_github_installation_idx` index is on.
 */
export const jsonText = <P = never>(expr: SQLite.Expr<unknown, P>, key: string) =>
	SQLite.cast(SQLite.jsonExtract(expr, `$.${key}`, nullableText), nullableText)
