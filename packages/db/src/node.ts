/**
 * Databases on node SQLite (`node:sqlite`, Node 24+ and Bun): tests, scripts and local processes.
 * Not for Workers; import from `@hazel/db/node`.
 */
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient"
import { Effect, Layer } from "effect"
import * as SqlClient from "effect/sql/SqlClient"
import { applyMigrations, renderStoreSchema } from "./schema-ddl"
import { type Database, layerSqlite } from "./services/database"
import { legacyTables, storeNames } from "./stores"

/** Applies every store's migrations (and the legacy tables) to one database. */
const migrateAll = Layer.effectDiscard(
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		for (const store of storeNames) yield* applyMigrations(sql, store)
		for (const statement of yield* renderStoreSchema(legacyTables)) yield* sql.unsafe(statement)
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
