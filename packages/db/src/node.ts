/**
 * Databases on node SQLite (`node:sqlite`, Node 24+ and Bun): tests, scripts and local processes.
 * Not for Workers; import from `@hazel/db/node`.
 */
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient"
import { Effect, Layer } from "effect"
import * as SqlClient from "effect/sql/SqlClient"
import { applyMigrations, type StoreMigration, storeMigrations } from "./schema-ddl"
import { type Database, layerSqlite } from "./services/database"
import { storeNames } from "./stores"

const ADD_COLUMN = /^ALTER TABLE "([^"]+)" ADD COLUMN "([^"]+)"/

/**
 * `migration` without the `ADD COLUMN`s already applied. One database holds every store here, and a
 * table two stores share (a projection) gets each store's copy of the same column.
 */
const withoutAppliedColumns = (sql: SqlClient.SqlClient, migration: StoreMigration) =>
	Effect.gen(function* () {
		const statements: Array<string> = []
		for (const statement of migration.statements) {
			const match = ADD_COLUMN.exec(statement)
			if (match !== null) {
				const columns = yield* sql<{
					readonly name: string
				}>`SELECT "name" FROM pragma_table_info(${match[1]!})`
				if (columns.some((column) => column.name === match[2])) continue
			}
			statements.push(statement)
		}
		return { ...migration, statements }
	})

/** Applies every store's migrations to one database. */
const migrateAll = Layer.effectDiscard(
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		for (const store of storeNames) {
			const migrations = yield* Effect.forEach(storeMigrations[store], (migration) =>
				withoutAppliedColumns(sql, migration),
			)
			const { failed } = yield* applyMigrations(sql, store, migrations)
			// Local databases have no reason to tolerate one.
			if (failed.length > 0) return yield* Effect.die(failed[0]!.error)
		}
	}),
)

/**
 * A file (or `:memory:`) database holding every store's tables, migrated on open. Provides the
 * `SqlClient` too, for code that writes SQL itself (auth storage).
 */
export const layerFile = (filename: string): Layer.Layer<Database | SqlClient.SqlClient> =>
	layerSqlite.pipe(
		Layer.provideMerge(migrateAll.pipe(Layer.provideMerge(SqliteClient.layer({ filename })))),
		Layer.orDie,
	)

/** A fresh in-memory database with every store's tables, for tests: each build is empty. */
export const layerMemory: Layer.Layer<Database | SqlClient.SqlClient> = Layer.suspend(() =>
	layerFile(":memory:"),
)
