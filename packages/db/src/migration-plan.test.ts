import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient"
import { renderSqliteSchema, sqliteEntitiesOf } from "@maple-dev/effect-orm/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { Effect } from "effect"
import * as SqlClient from "effect/sql/SqlClient"
import { describe, expect, it } from "vitest"
import {
	isMigrationName,
	nextMigrationId,
	planMigration,
	renderD1Migration,
	type StoreSchema,
} from "./migration-plan"
import { renderExtraIndex, type ExtraIndex } from "./tables/extra-indexes"
import { structuralSchema } from "./test-schema"

const widgetsV1 = SQLite.table("widgets", {
	columns: { id: SQLite.text, name: SQLite.text, kind: SQLite.nullable(SQLite.text) },
	primaryKey: ["id"],
	indexes: [SQLite.index("widgets_name_idx", ["name"])],
})

const widgetsV2 = SQLite.table("widgets", {
	columns: {
		id: SQLite.text,
		name: SQLite.text,
		kind: SQLite.nullable(SQLite.text),
		note: SQLite.nullable(SQLite.text),
	},
	primaryKey: ["id"],
	indexes: [SQLite.index("widgets_name_idx", ["name"])],
})

/** `kind` made NOT NULL with a default: SQLite can't alter that in place, so the table is rebuilt. */
const widgetsRebuilt = SQLite.table("widgets", {
	columns: { id: SQLite.text, name: SQLite.text, kind: SQLite.column(SQLite.text, { default: "plain" }) },
	primaryKey: ["id"],
	indexes: [SQLite.index("widgets_name_idx", ["name"])],
})

const widgetsNoKind = SQLite.table("widgets", {
	columns: { id: SQLite.text, name: SQLite.text },
	primaryKey: ["id"],
	indexes: [SQLite.index("widgets_name_idx", ["name"])],
})

const gadgets = SQLite.table("gadgets", { columns: { id: SQLite.text }, primaryKey: ["id"] })

const kindIndex: ExtraIndex = {
	name: "widgets_kind_unique",
	table: "widgets",
	unique: true,
	on: ["kind"],
	where: `"kind" IS NOT NULL`,
}

const schemaOf = (
	tables: ReadonlyArray<SQLite.SqliteSchemaTable<string, any>>,
	extraIndexes: ReadonlyArray<ExtraIndex> = [],
): StoreSchema => ({ entities: Effect.runSync(sqliteEntitiesOf(tables)), extraIndexes })

const ddlOf = (schema: StoreSchema) => [
	...renderSqliteSchema(schema.entities),
	...schema.extraIndexes.map(renderExtraIndex),
]

const run = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
	Effect.runPromise(effect.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))))

const exec = (statements: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		for (const statement of statements) yield* sql.unsafe(statement)
	})

/** Applies `previous`'s DDL then the plan, and checks the result is a fresh `next`. */
const expectPlanReaches = async (
	previous: StoreSchema,
	next: StoreSchema,
	statements: ReadonlyArray<string>,
) => {
	const migrated = await run(
		exec(ddlOf(previous)).pipe(
			Effect.andThen(exec([`INSERT INTO widgets (id, name) VALUES ('w1', 'one')`])),
			Effect.andThen(exec(statements)),
			Effect.andThen(structuralSchema),
		),
	)
	const fresh = await run(exec(ddlOf(next)).pipe(Effect.andThen(structuralSchema)))
	expect(migrated).toEqual(fresh)
}

describe("planMigration", () => {
	it("writes nothing when the tables match the snapshot", () => {
		const schema = schemaOf([widgetsV1, gadgets], [kindIndex])
		expect(planMigration(schema, schemaOf([gadgets, widgetsV1], [kindIndex]))).toEqual({
			_tag: "Unchanged",
		})
	})

	it("adds a column, a table and an extra index", async () => {
		const previous = schemaOf([widgetsV1])
		const next = schemaOf([widgetsV2, gadgets], [kindIndex])
		const plan = planMigration(previous, next)
		if (plan._tag !== "Planned") throw new Error(plan._tag)
		expect(plan.statements).toContain(`ALTER TABLE "widgets" ADD COLUMN "note" text`)
		expect(plan.statements.at(-1)).toBe(renderExtraIndex(kindIndex))
		await expectPlanReaches(previous, next, plan.statements)
	})

	it("drops and recreates a changed extra index", async () => {
		const previous = schemaOf([widgetsV1], [kindIndex])
		const next = schemaOf([widgetsV1], [{ ...kindIndex, unique: false }])
		const plan = planMigration(previous, next)
		if (plan._tag !== "Planned") throw new Error(plan._tag)
		expect(plan.statements).toEqual([
			`DROP INDEX IF EXISTS "widgets_kind_unique"`,
			renderExtraIndex({ ...kindIndex, unique: false }),
		])
		await expectPlanReaches(previous, next, plan.statements)
	})

	it("rebuilds a table, keeping its rows and recreating its extra indexes", async () => {
		const previous = schemaOf([widgetsV1], [kindIndex])
		const next = schemaOf([widgetsRebuilt], [kindIndex])
		const plan = planMigration(previous, next)
		if (plan._tag !== "Planned") throw new Error(plan._tag)
		expect(plan.statements.some((statement) => statement.startsWith("PRAGMA"))).toBe(false)
		expect(plan.statements.at(-1)).toBe(renderExtraIndex(kindIndex))
		await expectPlanReaches(previous, next, plan.statements)
		const rows = await run(
			exec([
				...ddlOf(previous),
				`INSERT INTO widgets (id, name) VALUES ('w1', 'one')`,
				...plan.statements,
			]).pipe(
				Effect.andThen(
					Effect.flatMap(SqlClient.SqlClient, (sql) => sql`SELECT id, kind FROM widgets`),
				),
			),
		)
		expect(rows).toEqual([{ id: "w1", kind: "plain" }])
	})

	it("asks for a hint before dropping a column", async () => {
		const previous = schemaOf([widgetsV1])
		const next = schemaOf([widgetsNoKind])
		const blocked = planMigration(previous, next)
		expect(blocked).toMatchObject({
			_tag: "Blocked",
			missingHints: [{ type: "confirm_data_loss", kind: "column", entity: "widgets.kind" }],
		})
		const plan = planMigration(previous, next, [
			{ type: "confirm_data_loss", kind: "column", entity: "widgets.kind" },
		])
		if (plan._tag !== "Planned") throw new Error(plan._tag)
		await expectPlanReaches(previous, next, plan.statements)
	})
})

describe("migration files", () => {
	it("numbers the next migration after the last", () => {
		expect(nextMigrationId([{ id: "0001_initial" }], "add_topic")).toBe("0002_add_topic")
		expect(isMigrationName("add_topic")).toBe(true)
		expect(isMigrationName("Add-Topic")).toBe(false)
	})

	it("writes the D1 migration.sql in 0001_initial's layout", () => {
		expect(renderD1Migration(["CREATE TABLE a (x)", "CREATE INDEX i ON a (x)"])).toBe(
			"CREATE TABLE a (x);\n--> statement-breakpoint\nCREATE INDEX i ON a (x);\n",
		)
	})
})
