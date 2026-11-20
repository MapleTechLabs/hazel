import { Database, SQLite, schema } from "@hazel/db"
import { formatWritePosition, type SyncSeq } from "@hazel/domain/sync"
import { TransactionId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import { currentObject } from "./current-object"

/**
 * The write position the client confirms its optimistic write against: `<kind>:<id>:<seq>`.
 *
 * Inside the transaction the change triggers have already appended this write's rows to
 * `_changes`, so its head is this write's seq. The object's invoke wrapper flushes (`afterCommit`)
 * before it answers, so the client never waits for a seq that was not broadcast. Call it last in
 * the transaction: a write after it would land past the returned seq.
 *
 * Off an object (the directory path, tests) the kind and id are unknown and the
 * position is `local:<seq>`, which no source confirms. Fails with the typed DatabaseError /
 * SchemaError, which callers remap with `withRemapDbErrors`.
 */
export const generateTransactionId = Effect.fn("generateTransactionId")(function* () {
	const db = yield* Database.Database
	const table = yield* db.first(
		SQLite.from(schema.sqliteMasterTable)
			.select("name")
			.where(($) => [$.type.eq("table"), $.name.eq("_changes")]),
	)
	const head = Option.isNone(table)
		? 0
		: Option.match(
				yield* db.first(
					SQLite.from(schema.changesTable).select(($) => ({
						head: SQLite.coalesce(SQLite.max($.seq), SQLite.lit(0)),
					})),
				),
				{ onNone: () => 0, onSome: (row) => row.head },
			)
	const object = yield* currentObject
	const position = Option.isSome(object)
		? formatWritePosition({ kind: object.value.kind, id: object.value.id, seq: head as SyncSeq })
		: `local:${head}`
	return yield* Schema.decodeEffect(TransactionId)(position)
}, Database.requireTransaction)
