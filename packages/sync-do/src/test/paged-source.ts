/**
 * A toy paged source for the tests: `notes` paged by `(created_at, id)` with dependent `likes`,
 * and a dependency-only `members` table (a change to it resnapshots everyone).
 */
import type { SyncPageCursor } from "@hazel/domain/sync"
import { Effect } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import type { SyncPage, SyncRow, SyncSource } from "../source.ts"

export interface PagedPrincipal {
	readonly userId: string
}

export const PAGED_DDL = `
	CREATE TABLE notes (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, body TEXT NOT NULL);
	CREATE TABLE likes (id TEXT PRIMARY KEY, note_id TEXT NOT NULL);
	CREATE TABLE members (user_id TEXT PRIMARY KEY);
`

interface NoteRow {
	readonly id: string
	readonly created_at: string
	readonly body: string
}

const placeholders = (values: ReadonlyArray<unknown>) => values.map(() => "?").join(", ")

const noteRow = (row: NoteRow): SyncRow => ({
	key: row.id,
	row: { id: row.id, createdAt: row.created_at, body: row.body },
})

export const makePagedSource = (options: {
	readonly snapshotLimit: number
	readonly maxLimit?: number
	/** `page` calls, as `before|null:limit`. */
	readonly pages?: Array<string>
}): SyncSource<PagedPrincipal, never, SqlClient> => {
	const page = (before: SyncPageCursor | null, limit: number) =>
		Effect.gen(function* () {
			options.pages?.push(`${before === null ? "null" : `${before.createdAt}/${before.id}`}:${limit}`)
			const sql = yield* SqlClient
			const filter = before === null ? "" : "WHERE created_at < ? OR (created_at = ? AND id < ?)"
			const notes = yield* sql.unsafe<NoteRow>(
				`SELECT id, created_at, body FROM notes ${filter} ORDER BY created_at DESC, id DESC LIMIT ?`,
				before === null ? [limit + 1] : [before.createdAt, before.createdAt, before.id, limit + 1],
			)
			const hasMore = notes.length > limit
			const window = notes.slice(0, limit)
			const ids = window.map((note) => note.id)
			const likes =
				ids.length === 0
					? []
					: yield* sql.unsafe<{ id: string; note_id: string }>(
							`SELECT id, note_id FROM likes WHERE note_id IN (${placeholders(ids)}) ORDER BY id`,
							ids,
						)
			const last = window.at(-1)
			return {
				rows: new Map([
					["notes", window.map(noteRow)],
					["likes", likes.map((row) => ({ key: row.id, row }))],
				]),
				oldest: last === undefined ? before : { createdAt: last.created_at, id: last.id },
				hasMore,
			} satisfies SyncPage
		}).pipe(Effect.orDie)

	const byKeys = <A extends object>(table: string, columns: string, keys: ReadonlyArray<string> | "all") =>
		Effect.gen(function* () {
			const sql = yield* SqlClient
			const filter = keys === "all" ? "" : ` WHERE id IN (${placeholders(keys)})`
			return yield* sql.unsafe<A>(
				`SELECT ${columns} FROM ${table}${filter} ORDER BY id`,
				keys === "all" ? [] : keys,
			)
		}).pipe(Effect.orDie)

	return {
		tables: [
			{
				name: "notes",
				key: ["id"],
				dependsOn: ["members"],
				load: (_principal, keys) =>
					Effect.map(byKeys<NoteRow>("notes", "id, created_at, body", keys), (rows) =>
						rows.map(noteRow),
					),
				paging: {
					snapshotLimit: options.snapshotLimit,
					maxLimit: options.maxLimit ?? 100,
					dependents: ["likes"],
					page: (_principal, before, limit) => page(before, limit),
				},
			},
			{
				name: "likes",
				key: ["id"],
				load: (_principal, keys) =>
					Effect.map(
						byKeys<{ id: string; note_id: string }>("likes", "id, note_id", keys),
						(rows) => rows.map((row) => ({ key: row.id, row })),
					),
			},
		],
		dependencies: [{ name: "members", key: ["user_id"] }],
		authorize: () => Effect.succeed(true),
		principalId: (principal) => principal.userId,
	}
}
