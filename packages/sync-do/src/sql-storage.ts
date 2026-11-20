/**
 * The synchronous subset of workerd's `ctx.storage.sql` the runtime's bookkeeping uses. Every call
 * runs synchronously, so inside an object each one is atomic. Tests back it with `node:sqlite`
 * (`./testing.ts`).
 */
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { syncMetaTable } from "./store.ts"

export type SqlValue = string | number | null | ArrayBuffer | Uint8Array

export interface SqlCursorLike<T> {
	toArray(): T[]
	/** Exactly one row, or throws (workerd's semantics). */
	one(): T
}

export interface SqlStorageLike {
	exec<T extends Record<string, SqlValue>>(query: string, ...bindings: Array<SqlValue>): SqlCursorLike<T>
}

/** `_sync_meta`: small persisted runtime state (cursor, trigger signature, retention floor). */
const META_TABLE = `CREATE TABLE IF NOT EXISTS _sync_meta (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
)`

export const installMeta = (sql: SqlStorageLike): void => {
	sql.exec(META_TABLE)
}

export const readMeta = (sql: SqlStorageLike, key: string): string | undefined =>
	SQLite.runSync(
		sql,
		SQLite.from(syncMetaTable)
			.select("value")
			.where(($) => [$.key.eq(key)]),
	)[0]?.value

export const writeMeta = (sql: SqlStorageLike, key: string, value: string): void => {
	SQLite.runSync(
		sql,
		SQLite.insertInto(syncMetaTable)
			.values({ key, value })
			.onConflictDoUpdate({ target: ["key"], set: SQLite.excluded(["value"]) }),
	)
}

export const readMetaNumber = (sql: SqlStorageLike, key: string): number => {
	const value = readMeta(sql, key)
	return value === undefined ? 0 : Number(value)
}

export const quoteIdent = (name: string): string => `"${name.replaceAll(`"`, `""`)}"`
