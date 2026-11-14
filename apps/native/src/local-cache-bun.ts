/**
 * The local cache's databases under Bun (`bun:sqlite`): one file per name in `directory`, or in
 * memory when there is none (the offline fixture, which starts the same every time).
 */
import { Database } from "bun:sqlite"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { databaseFileName, type LocalCacheHost, splitStatements, toBindable } from "./local-cache"

/** A file's side files: the write-ahead log and its index, and a rollback journal. */
const SIDE_FILES = ["", "-wal", "-shm", "-journal"]

/** SQLite's codes for a file that is no database, or a damaged one. */
const UNREADABLE = new Set(["SQLITE_NOTADB", "SQLITE_CORRUPT"])

/** An integer as the OPFS worker hands it over: a number while it is exact, else a bigint. */
const fromInteger = (value: bigint) =>
	value >= Number.MIN_SAFE_INTEGER && value <= Number.MAX_SAFE_INTEGER ? Number(value) : value

export const makeBunLocalCache = (directory: string | undefined): LocalCacheHost => {
	const opened = new Map<string, Database>()
	const pathOf = (name: string) => (directory === undefined ? ":memory:" : join(directory, name))
	const removeFiles = (name: string) => {
		if (directory === undefined) return
		for (const suffix of SIDE_FILES) rmSync(`${join(directory, name)}${suffix}`, { force: true })
	}
	const close = (name: string) => {
		opened.get(name)?.close()
		opened.delete(name)
	}
	const openDatabase = (name: string) => {
		// Every integer comes back a bigint, so one past 2^53 arrives whole (`fromInteger`).
		const db = new Database(pathOf(name), { create: true, readwrite: true, safeIntegers: true })
		try {
			// A write-ahead log: a crash mid-write leaves the last commit, never half a page.
			// Reading the schema is what finds a file that is no database.
			db.run(
				"PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; SELECT count(*) FROM sqlite_schema",
			)
		} catch (error) {
			db.close()
			throw error
		}
		return db
	}
	return {
		open: async (databaseName) => {
			const name = databaseFileName(databaseName)
			// One connection per file: an earlier one's unfinished transaction ends here.
			close(name)
			if (directory !== undefined) mkdirSync(directory, { recursive: true })
			let db: Database
			try {
				db = openDatabase(name)
			} catch (error) {
				if (!UNREADABLE.has((error as { code?: string }).code ?? "")) throw error
				// A cache that cannot be read starts over: its rows are all on the server.
				removeFiles(name)
				db = openDatabase(name)
			}
			opened.set(name, db)
			return {
				execute: async <TRow>(sql: string, params: ReadonlyArray<unknown> = []) => {
					const rows: Array<Record<string, unknown>> = []
					const values = params.map(toBindable)
					const statements = splitStatements(sql)
					// Checked before anything runs: a refused script must leave the database as it was.
					if (statements.length > 1 && values.length > 0)
						throw new Error("Parameters bind to a single SQL statement only")
					for (const statementSql of statements) {
						const statement = db.prepare(statementSql)
						try {
							for (const row of statement.all(...values) as Array<Record<string, unknown>>) {
								for (const column in row) {
									const value = row[column]
									if (typeof value === "bigint") row[column] = fromInteger(value)
								}
								rows.push(row)
							}
						} finally {
							statement.finalize()
						}
					}
					return rows as Array<TRow>
				},
				close: () => {
					if (opened.get(name) === db) opened.delete(name)
					db.close()
				},
			}
		},
		remove: async (databaseName) => {
			const name = databaseFileName(databaseName)
			close(name)
			removeFiles(name)
		},
	}
}
