/**
 * Each store's DDL and its versioned migrations.
 *
 * `renderStoreSchema` writes a store's current schema from its tables. `storeMigrations` is what a
 * store applies, in order: `0001_initial` is the committed render (`bun run db:generate-sqlite`
 * rewrites it, and a test fails when it drifts from the tables). Once a store is deployed, a schema
 * change is a new migration appended here, not an edit of `0001_initial`.
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
import { initialStatements } from "./migrations.generated"
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

/**
 * `OrgObject` message search: `message_search` (one row per indexed message, `createdAt` in epoch
 * ms) with an external-content FTS5 index kept in step by triggers, and the backfill's progress
 * per channel. Raw SQL: effect-orm does not model virtual tables or triggers.
 */
export const messageSearchStatements: ReadonlyArray<string> = [
	`CREATE TABLE IF NOT EXISTS "message_search" (
	"id" integer PRIMARY KEY,
	"messageId" text NOT NULL UNIQUE,
	"channelId" text NOT NULL,
	"authorId" text NOT NULL,
	"conversationId" text,
	"createdAt" integer NOT NULL,
	"content" text NOT NULL
)`,
	`CREATE INDEX IF NOT EXISTS "message_search_channel_created_idx" ON "message_search" ("channelId", "createdAt")`,
	`CREATE INDEX IF NOT EXISTS "message_search_created_idx" ON "message_search" ("createdAt", "messageId")`,
	`CREATE INDEX IF NOT EXISTS "message_search_author_idx" ON "message_search" ("authorId", "createdAt")`,
	`CREATE VIRTUAL TABLE IF NOT EXISTS "message_search_fts" USING fts5(content, content='message_search', content_rowid='id', tokenize='unicode61 remove_diacritics 2')`,
	`CREATE TRIGGER IF NOT EXISTS "message_search_ai" AFTER INSERT ON "message_search" BEGIN
	INSERT INTO "message_search_fts" (rowid, content) VALUES (new."id", new."content");
END`,
	`CREATE TRIGGER IF NOT EXISTS "message_search_ad" AFTER DELETE ON "message_search" BEGIN
	INSERT INTO "message_search_fts" ("message_search_fts", rowid, content) VALUES ('delete', old."id", old."content");
END`,
	`CREATE TRIGGER IF NOT EXISTS "message_search_au" AFTER UPDATE ON "message_search" BEGIN
	INSERT INTO "message_search_fts" ("message_search_fts", rowid, content) VALUES ('delete', old."id", old."content");
	INSERT INTO "message_search_fts" (rowid, content) VALUES (new."id", new."content");
END`,
	`CREATE TABLE IF NOT EXISTS "message_search_backfill" (
	"channelId" text PRIMARY KEY NOT NULL,
	"generation" integer NOT NULL,
	"done" integer NOT NULL DEFAULT 0
)`,
]

/** What a store's later migrations create beyond its tables' DDL (`renderStoreSchema`). */
export const unmodeledStatements: Record<StoreName, ReadonlyArray<string>> = {
	directory: [],
	org: messageSearchStatements,
	channel: [],
	user: [],
}

export const storeMigrations: Record<StoreName, ReadonlyArray<StoreMigration>> = {
	directory: [{ id: "0001_initial", statements: initialStatements.directory }],
	org: [
		{ id: "0001_initial", statements: initialStatements.org },
		{ id: "0002_message_search", statements: messageSearchStatements },
	],
	channel: [{ id: "0001_initial", statements: initialStatements.channel }],
	user: [{ id: "0001_initial", statements: initialStatements.user }],
}

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
