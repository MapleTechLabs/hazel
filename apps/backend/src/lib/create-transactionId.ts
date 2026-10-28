import { Database } from "@hazel/db"
import { formatWritePosition, type SyncSeq } from "@hazel/domain/sync"
import { TransactionId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import { currentObject } from "./current-object"

const HeadRow = Schema.Struct({ head: Schema.Number })

/**
 * The write position the client confirms its optimistic write against: `<kind>:<id>:<seq>`.
 *
 * Inside the transaction the change triggers have already appended this write's rows to
 * `_changes`, so its head is this write's seq. The object's invoke wrapper flushes (`afterCommit`)
 * before it answers, so the client never waits for a seq that was not broadcast. Call it last in
 * the transaction: a write after it would land past the returned seq.
 *
 * Off an object (the directory path, the Bun runtime) the kind and id are unknown and the
 * position is `local:<seq>`, which no source confirms. Fails with the typed DatabaseError /
 * SchemaError, which callers remap with `withRemapDbErrors`.
 */
export const generateTransactionId = Effect.fn("generateTransactionId")(function* () {
	const db = yield* Database.Database
	const tables = yield* db.query(
		Database.sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_changes'`,
	)
	const head =
		tables.length === 0
			? 0
			: ((yield* db.query(Database.sql`SELECT coalesce(max(seq), 0) AS head FROM _changes`, HeadRow))[0]
					?.head ?? 0)
	const object = yield* currentObject
	const position = Option.isSome(object)
		? formatWritePosition({ kind: object.value.kind, id: object.value.id, seq: head as SyncSeq })
		: `local:${head}`
	return yield* Schema.decodeEffect(TransactionId)(position)
}, Database.requireTransaction)
