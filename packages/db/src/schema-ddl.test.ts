import { readFileSync } from "node:fs"
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient"
import { Effect } from "effect"
import * as SqlClient from "effect/sql/SqlClient"
import { describe, expect, it } from "vitest"
import { initialStatements } from "./migrations.generated"
import { applyMigrations, renderStoreSchema, storeMigrations, unmodeledStatements } from "./schema-ddl"
import { storeNames, storeTables } from "./stores"

const withSqlite = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
	Effect.runPromise(effect.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))))

/** The schema SQLite holds, as its own normalized `CREATE` text. */
const schemaOf = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient
	const rows = yield* sql<{ readonly sql: string }>`
		SELECT sql FROM sqlite_master
		WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name != '_migrations'
		ORDER BY type, name`
	return rows.map((row) => row.sql)
})

describe.each(storeNames)("the %s store", (store) => {
	it("commits an initial migration equal to the tables' DDL (run `bun run db:generate-sqlite`)", async () => {
		const rendered = await Effect.runPromise(renderStoreSchema(storeTables[store]))
		expect(initialStatements[store]).toEqual(rendered)
	})

	it("migrates to the schema its tables declare", async () => {
		const migrated = await withSqlite(
			Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient
				const applied = yield* applyMigrations(sql, store)
				expect(applied).toEqual(storeMigrations[store].map((migration) => migration.id))
				expect(yield* applyMigrations(sql, store)).toEqual([])
				return yield* schemaOf
			}),
		)
		const fresh = await withSqlite(
			Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient
				for (const statement of yield* renderStoreSchema(storeTables[store]))
					yield* sql.unsafe(statement)
				for (const statement of unmodeledStatements[store]) yield* sql.unsafe(statement)
				return yield* schemaOf
			}),
		)
		expect(migrated).toEqual(fresh)
	})
})

describe("the D1 migration folder", () => {
	it("holds the directory's initial migration (run `bun run db:generate-sqlite`)", () => {
		const file = readFileSync(
			new URL("../migrations/directory/0001_initial/migration.sql", import.meta.url),
			"utf8",
		)
		expect(file).toBe(`${initialStatements.directory.join(";\n--> statement-breakpoint\n")};\n`)
	})
})

describe("table defaults", () => {
	it("fills a v4 uuid id and the current time when an insert leaves them out", async () => {
		const row = await withSqlite(
			Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient
				yield* applyMigrations(sql, "org")
				yield* sql`INSERT INTO organizations (name) VALUES ('Acme')`
				const [row] = yield* sql<{ readonly id: string; readonly createdAt: string }>`
					SELECT id, "createdAt" FROM organizations`
				return row!
			}),
		)
		expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
		expect(row.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/)
	})
})
