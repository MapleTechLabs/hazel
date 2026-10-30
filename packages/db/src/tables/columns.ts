/**
 * Column types Hazel's tables share, beyond the ones `@maple-dev/effect-orm/sqlite` ships.
 *
 * Timestamps read as `Date`, the shape the domain models and every caller already work with;
 * comparisons and writes also take a `DateTime.Utc` or an ISO string. They are stored in SQLite's
 * own text form (`YYYY-MM-DD HH:MM:SS.SSS`, UTC), the form `SQLite.timestampNow` writes, so a
 * column orders by time.
 */
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { DateTime, Schema, SchemaGetter } from "effect"

/** `YYYY-MM-DD HH:MM:SS[.SSS]` with no zone is SQLite's form, read as UTC. */
const SQLITE_TEXT = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/

const parseTimestamp = (value: string): Date =>
	new Date(SQLITE_TEXT.test(value) ? `${value.replace(" ", "T")}Z` : value)

const timestampText = (date: Date): string => {
	const iso = date.toISOString()
	return `${iso.slice(0, 10)} ${iso.slice(11, 23)}`
}

const isTimestampText = Schema.makeFilter(
	(value: string) =>
		Number.isNaN(parseTimestamp(value).getTime()) ? `\`${value}\` is not a timestamp` : undefined,
	{ title: "timestamp" },
)

/** SQLite timestamp text (or ISO-8601), read as a `Date`. */
const DateFromText: Schema.Codec<Date, string> = Schema.String.pipe(
	Schema.check(isTimestampText),
	Schema.decodeTo(Schema.Date, {
		decode: SchemaGetter.transform(parseTimestamp),
		encode: SchemaGetter.transform(timestampText),
	}),
)

/** What a comparison or param takes: a `Date`, a `DateTime.Utc` or timestamp text. */
const TimestampLiteral = Schema.Union([
	DateFromText,
	Schema.String.pipe(
		Schema.check(isTimestampText),
		Schema.decodeTo(Schema.DateTimeUtc, {
			decode: SchemaGetter.transform((value: string) => DateTime.fromDateUnsafe(parseTimestamp(value))),
			encode: SchemaGetter.transform((value: DateTime.Utc) => timestampText(DateTime.toDate(value))),
		}),
	),
	Schema.String.pipe(
		Schema.check(isTimestampText),
		Schema.decodeTo(Schema.String, {
			decode: SchemaGetter.transform((value: string) => value),
			encode: SchemaGetter.transform((value: string) => timestampText(parseTimestamp(value))),
		}),
	),
]) as Schema.Codec<unknown, unknown>

/** An instant, stored as ISO text and read and written as a `Date`. */
export const timestamptz: SQLite.SqliteType<"text", Date, string> = SQLite.custom(
	"text",
	DateFromText,
	TimestampLiteral,
)

/** Text; SQLite does not enforce a length, so `length` is documentation only. */
export const varchar = (_length: number): SQLite.SqliteType<"text", string> => SQLite.text

/**
 * A JSON document typed as `A` without validating it: stored documents predate some of the shapes
 * their readers expect, and a strict decode would fail the whole read instead of the one field.
 */
export const jsonb = <A>(): SQLite.SqliteType<"text", A, string> =>
	SQLite.json(Schema.Unknown as Schema.Codec<A, unknown>) as SQLite.SqliteType<"text", A, string>

/** Narrows a column's TypeScript type without a runtime check. */
export const typed =
	<A>() =>
	<T extends SQLite.SqliteType<string, any, any>>(
		type: T,
	): SQLite.SqliteType<string, A, SQLite.InferEncoded<T>> =>
		type as unknown as SQLite.SqliteType<string, A, SQLite.InferEncoded<T>>

/** The current time, typed as the `Date` the timestamp columns hold. */
export const now = () => SQLite.sql(timestamptz)`strftime('%Y-%m-%d %H:%M:%f', 'now')`

/**
 * A text id typed as a branded id. The brand is type-only: rows are not re-validated against the
 * id schema on read, so one stored id outside its schema's checks cannot fail a whole result set.
 */
export const uuid = <S extends Schema.Top>(_id: S): SQLite.SqliteType<string, S["Type"], string> =>
	typed<S["Type"]>()(SQLite.text)

/** A text column holding one of `values`, decoded as their literal union. */
export const textEnum = <const Values extends ReadonlyArray<string>>(
	values: Values,
): SQLite.SqliteType<"text", Values[number], string> =>
	SQLite.custom("text", Schema.Literals(values) as unknown as Schema.Codec<Values[number], string>)

/** `DEFAULT` for an id column: a random lowercase v4 UUID. */
export const randomUuid =
	"(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || " +
	"substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || " +
	"substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))))"
