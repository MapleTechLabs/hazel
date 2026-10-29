import { Database } from "@hazel/db"
import { layerMemory } from "@hazel/db/node"
import { Context, Effect, Exit, Layer, Scope } from "effect"
import * as SqlClient from "effect/sql/SqlClient"

/**
 * One in-memory SQLite database with every store's tables, shared by a test file: `dbLayer`
 * provides the same database (and its `SqlClient`) to every effect, and `reset` empties it.
 */
export interface ChatSyncDbHarness {
	readonly dbLayer: Layer.Layer<Database.Database | SqlClient.SqlClient>
	run: <A, E, R>(effect: Effect.Effect<A, E, R>) => Promise<A>
	reset: () => Promise<void>
	stop: () => Promise<void>
}

export const createChatSyncDbHarness = async (): Promise<ChatSyncDbHarness> => {
	const scope = Effect.runSync(Scope.make())
	const context = await Effect.runPromise(Layer.buildWithScope(layerMemory, scope))
	const dbLayer = Layer.succeedContext(context)

	const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
		Effect.runPromise(
			(effect as Effect.Effect<A, E, Database.Database | SqlClient.SqlClient>).pipe(
				Effect.provide(context),
				Effect.scoped,
			),
		)

	const reset = () =>
		run(
			Effect.gen(function* () {
				const sql = Context.get(context, SqlClient.SqlClient)
				const tables = yield* sql<{ readonly name: string }>`
					SELECT name FROM sqlite_master
					WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '_migrations'
						AND name NOT LIKE 'message_search_fts%'`
				for (const { name } of tables) yield* sql`DELETE FROM ${sql(name)}`
			}),
		)

	return {
		dbLayer,
		run,
		reset,
		stop: () => Effect.runPromise(Scope.close(scope, Exit.void)),
	}
}
