/**
 * Each store's DDL and its versioned migrations.
 *
 * `renderStoreSchema` writes a store's current schema from its tables. `storeMigrations` is what a
 * store applies, in order, from `migrations.generated.ts`: `bun run db:generate-sqlite --name <name>`
 * appends the diff from the store's snapshot (`snapshots/<store>.json`), and a test fails while the
 * tables differ from it. Committed migrations are never edited.
 */
import {
	sqliteEntitiesOf,
	renderSqliteSchema,
	type SchemaDefinitionError,
} from "@maple-dev/effect-orm/schema"
import type { SqliteSchemaTable } from "@maple-dev/effect-orm/sqlite"
import { Effect } from "effect"
import type * as SqlClient from "effect/sql/SqlClient"
import type { SqlError } from "effect/sql/SqlError"
import { generatedMigrations } from "./migrations.generated"
import type { StoreName } from "./stores"
import { extraIndexes, renderExtraIndex } from "./tables/extra-indexes"

/** `CREATE TABLE` / `CREATE INDEX` statements for `tables`, extra (partial) indexes included. */
export const renderStoreSchema = (
	tables: ReadonlyArray<SqliteSchemaTable<string, any>>,
): Effect.Effect<ReadonlyArray<string>, SchemaDefinitionError> =>
	sqliteEntitiesOf(dedupe(tables)).pipe(
		Effect.map((entities) => {
			const names = new Set(tables.map((table) => table.name))
			return [
				...renderSqliteSchema(entities),
				...extraIndexes.filter((index) => names.has(index.table)).map(renderExtraIndex),
			]
		}),
	)

/** A projection table can be listed twice when stores are combined. */
const dedupe = <T extends { readonly name: string }>(tables: ReadonlyArray<T>): ReadonlyArray<T> => [
	...new Map(tables.map((table) => [table.name, table])).values(),
]

export interface StoreMigration {
	readonly id: string
	readonly statements: ReadonlyArray<string>
}

export const storeMigrations: Record<StoreName, ReadonlyArray<StoreMigration>> = generatedMigrations

/** The ledger `applyMigrations` keeps: `(store, id)`, so stores can share a test database. */
export const MIGRATIONS_TABLE = "_migrations"

/**
 * Applies `store`'s pending migrations, each in its own transaction with its ledger row, and
 * returns the ids it applied. For DO SQLite and node SQLite; D1's are applied by Alchemy from
 * `migrations/directory`.
 */
export const applyMigrations = (
	sql: SqlClient.SqlClient,
	store: StoreName,
	migrations: ReadonlyArray<StoreMigration> = storeMigrations[store],
): Effect.Effect<ReadonlyArray<string>, SqlError> =>
	Effect.gen(function* () {
		yield* sql.unsafe(
			`CREATE TABLE IF NOT EXISTS "${MIGRATIONS_TABLE}" ("store" text NOT NULL, "id" text NOT NULL, "appliedAt" text NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')), PRIMARY KEY ("store", "id"))`,
		)
		const rows = yield* sql<{
			readonly id: string
		}>`SELECT "id" FROM ${sql(MIGRATIONS_TABLE)} WHERE "store" = ${store}`
		const applied = new Set(rows.map((row) => row.id))
		const pending = migrations.filter((migration) => !applied.has(migration.id))
		for (const migration of pending) {
			yield* sql.withTransaction(
				Effect.gen(function* () {
					for (const statement of migration.statements) yield* sql.unsafe(statement)
					yield* sql`INSERT INTO ${sql(MIGRATIONS_TABLE)} ("store", "id") VALUES (${store}, ${migration.id})`
				}),
			)
		}
		return pending.map((migration) => migration.id)
	}).pipe(Effect.withSpan("Database.applyMigrations", { attributes: { store } }))
