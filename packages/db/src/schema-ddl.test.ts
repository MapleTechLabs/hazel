import { readdirSync, readFileSync } from "node:fs"
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient"
import { Effect } from "effect"
import * as SqlClient from "effect/sql/SqlClient"
import { describe, expect, it } from "vitest"
import { planMigration, renderD1Migration, storeSchemaOf, type StoreSnapshot } from "./migration-plan"
import { applyMigrations, renderStoreSchema, storeMigrations } from "./schema-ddl"
import { storeNames, storeTables } from "./stores"
import { structuralSchema } from "./test-schema"

const withSqlite = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
	Effect.runPromise(effect.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))))

const snapshotOf = (store: string): StoreSnapshot =>
	JSON.parse(readFileSync(new URL(`../snapshots/${store}.json`, import.meta.url), "utf8"))

describe.each(storeNames)("the %s store", (store) => {
	it("has no schema change pending (run `bun run db:generate-sqlite --name <name>`)", async () => {
		const snapshot = snapshotOf(store)
		expect(snapshot.migration).toBe(storeMigrations[store].at(-1)!.id)
		const current = await Effect.runPromise(storeSchemaOf(storeTables[store]))
		expect(planMigration(snapshot, current)).toEqual({ _tag: "Unchanged" })
	})

	it("numbers its migrations in order, starting with 0001_initial", () => {
		const ids = storeMigrations[store].map((migration) => migration.id)
		expect(ids[0]).toBe("0001_initial")
		ids.forEach((id, i) => expect(id.startsWith(`${String(i + 1).padStart(4, "0")}_`)).toBe(true))
	})

	it("migrates to the schema its tables declare", async () => {
		const migrated = await withSqlite(
			Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient
				const applied = yield* applyMigrations(sql, store)
				expect(applied).toEqual(storeMigrations[store].map((migration) => migration.id))
				expect(yield* applyMigrations(sql, store)).toEqual([])
				return yield* structuralSchema
			}),
		)
		const fresh = await withSqlite(
			Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient
				for (const statement of yield* renderStoreSchema(storeTables[store]))
					yield* sql.unsafe(statement)
				return yield* structuralSchema
			}),
		)
		expect(migrated).toEqual(fresh)
	})
})

describe("the D1 migration folder", () => {
	it("holds each directory migration, in the layout Alchemy applies", () => {
		const folder = new URL("../migrations/directory/", import.meta.url)
		expect(readdirSync(folder).sort()).toEqual(storeMigrations.directory.map((migration) => migration.id))
		for (const migration of storeMigrations.directory) {
			const file = readFileSync(new URL(`${migration.id}/migration.sql`, folder), "utf8")
			expect(file).toBe(renderD1Migration(migration.statements))
		}
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
