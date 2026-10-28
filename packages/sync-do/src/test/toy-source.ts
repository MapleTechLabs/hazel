/**
 * A toy two-table source for the tests: `projects` (public or private) and `tasks`, with a
 * dependency-only `access` table granting private projects. Loads go through the object's effect
 * `SqlClient`, as a real object's do.
 */
import { Effect } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import type { SyncSource } from "../source.ts"

export interface ToyPrincipal {
	readonly userId: string
	readonly expiresAt?: number
}

export const TOY_DDL = `
	CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, private INTEGER NOT NULL DEFAULT 0);
	CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL);
	CREATE TABLE access (project_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (project_id, user_id));
`

const VISIBLE_PROJECT = `(p.private = 0 OR EXISTS (
	SELECT 1 FROM access a WHERE a.project_id = p.id AND a.user_id = ?
))`

export interface ToyControls {
	/** Users `authorize` refuses. */
	readonly banned: Set<string>
	/** Users `authorize` reports `not_found` for. */
	readonly missing: Set<string>
	/** Users whose `load` fails. */
	readonly failing: Set<string>
	/** `load` calls, as `table:userId:keys|all`. */
	readonly loads: Array<string>
}

export const makeToyControls = (): ToyControls => ({
	banned: new Set(),
	missing: new Set(),
	failing: new Set(),
	loads: [],
})

const placeholders = (keys: ReadonlyArray<string>) => keys.map(() => "?").join(", ")

export const makeToySource = (controls: ToyControls): SyncSource<ToyPrincipal, Error, SqlClient> => {
	const guard = (table: string, principal: ToyPrincipal, keys: ReadonlyArray<string> | "all") =>
		Effect.suspend(() => {
			controls.loads.push(`${table}:${principal.userId}:${keys === "all" ? "all" : keys.join(",")}`)
			return controls.failing.has(principal.userId)
				? Effect.fail(new Error(`load failed for ${principal.userId}`))
				: Effect.void
		})
	const accessToUsers = (changes: ReadonlyArray<{ readonly pk: string }>) =>
		changes.map((change) => change.pk.split(":")[1]!)
	return {
		tables: [
			{
				name: "projects",
				key: ["id"],
				dependsOn: ["access"],
				affectedPrincipals: accessToUsers,
				load: (principal, keys) =>
					Effect.gen(function* () {
						yield* guard("projects", principal, keys)
						const sql = yield* SqlClient
						const filter = keys === "all" ? "" : ` AND p.id IN (${placeholders(keys)})`
						const rows = yield* sql.unsafe<{ id: string; name: string; private: number }>(
							`SELECT p.id, p.name, p.private FROM projects p WHERE ${VISIBLE_PROJECT}${filter} ORDER BY p.id`,
							[principal.userId, ...(keys === "all" ? [] : keys)],
						)
						return rows.map((row) => ({
							key: row.id,
							row: { ...row, private: row.private === 1 },
						}))
					}).pipe(Effect.catchTag("SqlError", Effect.die)),
			},
			{
				name: "tasks",
				key: ["id"],
				dependsOn: ["access"],
				affectedPrincipals: accessToUsers,
				load: (principal, keys) =>
					Effect.gen(function* () {
						yield* guard("tasks", principal, keys)
						const sql = yield* SqlClient
						const filter = keys === "all" ? "" : ` AND t.id IN (${placeholders(keys)})`
						const rows = yield* sql.unsafe<{ id: string; project_id: string; title: string }>(
							`SELECT t.id, t.project_id, t.title FROM tasks t JOIN projects p ON p.id = t.project_id
							WHERE ${VISIBLE_PROJECT}${filter} ORDER BY t.id`,
							[principal.userId, ...(keys === "all" ? [] : keys)],
						)
						return rows.map((row) => ({ key: row.id, row }))
					}).pipe(Effect.catchTag("SqlError", Effect.die)),
			},
		],
		dependencies: [{ name: "access", key: ["project_id", "user_id"] }],
		authorize: (principal) =>
			Effect.sync(() =>
				controls.missing.has(principal.userId) ? "not_found" : !controls.banned.has(principal.userId),
			),
		principalId: (principal) => principal.userId,
		expiresAt: (principal) => principal.expiresAt,
	}
}
