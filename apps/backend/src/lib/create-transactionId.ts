import { Database } from "@hazel/db"
import { TransactionIdFromString } from "@hazel/schema"
import { Effect, Schema } from "effect"

const TxidRow = Schema.Struct({ txid: Schema.String })

/**
 * The id the client confirms its optimistic write against: for now the head of the store's
 * `_changes` log (written by `packages/sync-do`), or 0 before it exists. Replaced by the
 * object's commit `seq` once writes go through the objects.
 * Must run inside `db.transaction`. Fails with the typed DatabaseError / SchemaError, which
 * callers remap with `withRemapDbErrors`.
 */
export const generateTransactionId = Effect.fn("generateTransactionId")(function* () {
	const db = yield* Database.Database
	const tables = yield* db.query(
		Database.sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_changes'`,
	)
	if (tables.length === 0) return yield* Schema.decodeEffect(TransactionIdFromString)("0")
	const rows = yield* db.query(
		Database.sql`SELECT CAST(coalesce(max(seq), 0) AS TEXT) AS txid FROM _changes`,
		TxidRow,
	)
	return yield* Schema.decodeEffect(TransactionIdFromString)(rows[0]?.txid ?? "0")
}, Database.requireTransaction)
