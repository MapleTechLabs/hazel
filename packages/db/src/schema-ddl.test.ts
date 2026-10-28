import { readdirSync, readFileSync } from "node:fs"
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient"
import { Effect } from "effect"
import * as SqlClient from "effect/sql/SqlClient"
import { describe, expect, it } from "vitest"
import { planMigration, renderD1Migration, storeSchemaOf, type StoreSnapshot } from "./migration-plan"
import { applyMigrations, renderStoreSchema, storeMigrations, unmodeledStatements } from "./schema-ddl"
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
				const report = yield* applyMigrations(sql, store)
				expect(report).toEqual({
					applied: storeMigrations[store].map((migration) => migration.id),
					failed: [],
				})
				expect(yield* applyMigrations(sql, store)).toEqual({ applied: [], failed: [] })
				return yield* structuralSchema
			}),
		)
		const fresh = await withSqlite(
			Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient
				for (const statement of yield* renderStoreSchema(storeTables[store]))
					yield* sql.unsafe(statement)
				for (const statement of unmodeledStatements[store]) yield* sql.unsafe(statement)
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

describe("optional migrations", () => {
	const migrations = [
		{ id: "0001_initial", statements: [`CREATE TABLE "a" ("id" text)`] },
		{
			id: "0002_broken",
			optional: true as const,
			statements: [`CREATE TABLE "b" ("id" text)`, `NOT SQL`],
		},
		{ id: "0003_later", statements: [`CREATE TABLE "c" ("id" text)`] },
	]

	it("reports a failing optional migration, rolls it back, runs the rest and retries it next time", async () => {
		const outcome = await withSqlite(
			Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient
				const first = yield* applyMigrations(sql, "org", migrations)
				const tables = yield* sql<{ readonly name: string }>`
					SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('a', 'b', 'c') ORDER BY name`
				const retried = yield* applyMigrations(sql, "org", [
					...migrations.slice(0, 1),
					{ ...migrations[1]!, statements: [`CREATE TABLE "b" ("id" text)`] },
					...migrations.slice(2),
				])
				return { first, tables: tables.map((row) => row.name), retried }
			}),
		)
		expect(outcome.first.applied).toEqual(["0001_initial", "0003_later"])
		expect(outcome.first.failed.map((failure) => failure.id)).toEqual(["0002_broken"])
		expect(outcome.tables).toEqual(["a", "c"])
		expect(outcome.retried).toEqual({ applied: ["0002_broken"], failed: [] })
	})

	it("fails the run when a required migration fails", async () => {
		const exit = await Effect.runPromiseExit(
			Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient
				return yield* applyMigrations(sql, "org", [{ id: "0001_initial", statements: ["NOT SQL"] }])
			}).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
		)
		expect(exit._tag).toBe("Failure")
	})
})
