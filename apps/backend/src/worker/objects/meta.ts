/**
 * `_object_meta`: an object's own small facts, outside the synced tables.
 *
 * - `id`: the object's DO name (organization, channel or user id). workerd does not reliably
 *   expose it, so every entry point carries it (`invoke`/`applyEffect` take `objectId`, the sync
 *   upgrade an `x-hazel-object-id` header) and the first one stores it. The alarm reads it back.
 * - `ChannelObject`: `organizationId`, `conversationId` and `mountChannelIds` (a Connect host
 *   channel's guest mounts) from the last `setViewers`.
 */
import { Effect, Option } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import type { SqlError } from "effect/sql/SqlError"

const TABLE = `CREATE TABLE IF NOT EXISTS _object_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`

export const installObjectMeta: Effect.Effect<void, SqlError, SqlClient> = Effect.flatMap(SqlClient, (sql) =>
	sql.unsafe(TABLE),
).pipe(Effect.asVoid)

export const readObjectMeta = (key: string): Effect.Effect<Option.Option<string>, SqlError, SqlClient> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient
		const rows = yield* sql<{ value: string }>`SELECT value FROM _object_meta WHERE key = ${key}`
		return Option.fromNullishOr(rows[0]?.value)
	})

export const writeObjectMeta = (key: string, value: string): Effect.Effect<void, SqlError, SqlClient> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient
		yield* sql`INSERT INTO _object_meta (key, value) VALUES (${key}, ${value})
			ON CONFLICT (key) DO UPDATE SET value = excluded.value`
	})

export const deleteObjectMeta = (key: string): Effect.Effect<void, SqlError, SqlClient> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient
		yield* sql`DELETE FROM _object_meta WHERE key = ${key}`
	})

/**
 * Remembers the object's id on first sight and checks it afterwards: one object, one id. A
 * mismatch means a routing bug, so it is a defect.
 */
export const makeObjectIdentity = Effect.gen(function* () {
	let known = Option.getOrUndefined(yield* readObjectMeta("id"))
	const remember = (id: string): Effect.Effect<string, SqlError, SqlClient> =>
		Effect.gen(function* () {
			if (known === id) return id
			if (known !== undefined) {
				return yield* Effect.die(new Error(`Object ${known} was addressed as ${id}`))
			}
			yield* writeObjectMeta("id", id)
			known = id
			return id
		})
	return {
		remember,
		/** The id, once any entry point carried it. */
		current: () => known,
	}
})

export type ObjectIdentity = Effect.Success<typeof makeObjectIdentity>
