/**
 * Rows for the one-shot Postgres import (`scripts/import-postgres.ts` → `POST /internal/import`).
 *
 * On the wire a row is its table's encoded (stored) form: timestamps as SQLite text, JSON as text,
 * booleans as 0/1. The script encodes with the column codecs; the receiver decodes and re-encodes
 * the same way, so a row that fails either side is skipped, and writes it with `INSERT OR REPLACE`
 * (idempotent: re-running the import overwrites).
 */
import { type StoreName, storeTables } from "@hazel/db/stores"
import { Effect, Option, Schema } from "effect"

export type ImportStore = StoreName

export const ImportStoreSchema = Schema.Literals(["directory", "org", "channel", "user"])

/** An encoded row: column name → stored value. */
export const ImportRow = Schema.Record(Schema.String, Schema.Unknown)
export type ImportRow = typeof ImportRow.Type

/** One request body: a batch of rows of one table, or the store's finalize step. */
export const ImportRequest = Schema.Union([
	Schema.Struct({ table: Schema.String, rows: Schema.Array(ImportRow) }),
	Schema.Struct({ finalize: Schema.Literal(true) }),
])
export type ImportRequest = typeof ImportRequest.Type

export const ImportResult = Schema.Struct({ applied: Schema.Number, skipped: Schema.Number })
export type ImportResult = typeof ImportResult.Type

/** A batch named a table its store does not hold. */
export class ImportTableError extends Schema.TaggedError<ImportTableError>()("ImportTableError", {
	store: Schema.String,
	table: Schema.String,
}) {}

interface ColumnLike {
	readonly schema: Schema.Codec<unknown, unknown>
}

/** The effect-orm table as the import reads it. */
export interface ImportTable {
	readonly name: string
	readonly columns: Readonly<Record<string, ColumnLike>>
	/** Columns with a default: omitted from the insert when the row lacks them. */
	readonly defaults: ReadonlyArray<string>
}

export const importTableOf = (store: ImportStore, name: string): Option.Option<ImportTable> =>
	Option.fromNullishOr(
		(storeTables[store] as unknown as ReadonlyArray<ImportTable>).find((table) => table.name === name),
	)

/** A source value's second try when its column rejects it as is (Postgres text forms). */
const fallbackOf = (value: unknown): unknown => {
	if (value instanceof Date) return value.toISOString()
	if (typeof value === "bigint") return Number(value)
	if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) return Number(value)
	if (typeof value === "string" && (value === "t" || value === "f")) return value === "t"
	return undefined
}

const nullish = (value: unknown) => value === undefined || value === null

/**
 * A source row (decoded values: `Date`, objects, booleans) in the table's encoded form. Columns
 * the source lacks are left to their default, or null; unknown source columns are dropped.
 */
export const encodeImportRow = (
	table: ImportTable,
	source: Readonly<Record<string, unknown>>,
): Effect.Effect<ImportRow, Schema.SchemaError> =>
	Effect.gen(function* () {
		const row: Record<string, unknown> = {}
		for (const [name, column] of Object.entries(table.columns)) {
			const value = source[name]
			if (value === undefined && table.defaults.includes(name)) continue
			const encode = Schema.encodeUnknownEffect(column.schema)
			row[name] = yield* encode(value === undefined ? null : value).pipe(
				Effect.catchTag("SchemaError", (error) => {
					const fallback = fallbackOf(value)
					return fallback === undefined ? Effect.fail(error) : encode(fallback)
				}),
			)
		}
		return row
	})

/** Validate an encoded row against the table (decode, then encode again). */
export const canonicalRow = (
	table: ImportTable,
	row: ImportRow,
): Effect.Effect<ImportRow, Schema.SchemaError> =>
	Effect.gen(function* () {
		const out: Record<string, unknown> = {}
		for (const [name, column] of Object.entries(table.columns)) {
			const value = row[name]
			if (nullish(value) && table.defaults.includes(name)) continue
			const decoded = yield* Schema.decodeUnknownEffect(column.schema)(value ?? null)
			out[name] = yield* Schema.encodeUnknownEffect(column.schema)(decoded)
		}
		return out
	})

const ident = (name: string) => `"${name.replaceAll('"', '""')}"`

/** `INSERT OR REPLACE` of one canonical row. */
export const upsertStatement = (table: ImportTable, row: ImportRow) => {
	const names = Object.keys(row)
	return {
		sql: `INSERT OR REPLACE INTO ${ident(table.name)} (${names.map(ident).join(", ")}) VALUES (${names
			.map(() => "?")
			.join(", ")})`,
		params: names.map((name) => row[name]),
	}
}
