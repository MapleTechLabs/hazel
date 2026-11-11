/**
 * Node test doubles for a Durable Object: `ctx.storage` over `node:sqlite` (enough of it for the
 * runtime and for `@effect/sql-sqlite-do`), and hibernatable sockets that record what they were
 * sent. Objects' tests run their real `SqliteClient` over the same database as the runtime.
 */
import * as SqliteDo from "@effect/sql-sqlite-do/SqliteClient"
import type { Layer } from "effect"
import type { SqlClient } from "effect/sql/SqlClient"
import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import type { SyncObjectState, SyncSocket } from "./runtime.ts"
import type { SqlCursorLike, SqlStorageLike, SqlValue } from "./sql-storage.ts"

const toInput = (value: SqlValue | boolean | undefined): SQLInputValue => {
	if (value instanceof ArrayBuffer) return new Uint8Array(value)
	if (typeof value === "boolean") return value ? 1 : 0
	return value ?? null
}

interface NodeCursor<T> extends SqlCursorLike<T> {
	readonly columnNames: Array<string>
	raw(): IterableIterator<Array<unknown>>
}

/** Durable Object SQLite binds at most this many parameters per statement. */
export const MAX_BOUND_PARAMETERS = 100

/** `ctx.storage.sql` over `node:sqlite`. One statement per `exec`, as the runtime issues them. */
export const nodeSqlStorage = (
	db: DatabaseSync,
): SqlStorageLike & {
	exec<T extends Record<string, SqlValue>>(query: string, ...bindings: Array<SqlValue>): NodeCursor<T>
} => ({
	exec: <T extends Record<string, SqlValue>>(
		query: string,
		...bindings: Array<SqlValue>
	): NodeCursor<T> => {
		// workerd's limit, which node's SQLite does not have.
		if (bindings.length > MAX_BOUND_PARAMETERS) {
			throw new Error(`too many SQL variables: ${bindings.length} (max ${MAX_BOUND_PARAMETERS})`)
		}
		const statement = db.prepare(query)
		const columnNames = statement.columns().map((column) => column.name)
		const rows = statement.all(...bindings.map(toInput)) as Array<T>
		return {
			columnNames,
			toArray: () => rows,
			one: () => {
				if (rows.length !== 1) throw new Error(`Expected exactly one row, got ${rows.length}`)
				return rows[0]!
			},
			raw: () =>
				rows
					.map((row) => columnNames.map((name) => (row as Record<string, unknown>)[name]))
					[Symbol.iterator](),
		}
	},
})

export interface FakeStorage {
	readonly db: DatabaseSync
	readonly sql: ReturnType<typeof nodeSqlStorage>
	/** `storage.transaction`: savepoints, so nested calls roll back alone (workerd's semantics). */
	transaction<T>(closure: (txn: { rollback(): void }) => Promise<T>): Promise<T>
	getAlarm(): Promise<number | null>
	setAlarm(scheduledTime: number): Promise<void>
	deleteAlarm(): Promise<void>
	/** The armed alarm, synchronously. */
	readonly alarm: () => number | null
}

export const makeFakeStorage = (db: DatabaseSync = new DatabaseSync(":memory:")): FakeStorage => {
	let savepoints = 0
	let alarm: number | null = null
	return {
		db,
		sql: nodeSqlStorage(db),
		async transaction(closure) {
			const name = `sp_${++savepoints}`
			db.exec(`SAVEPOINT ${name}`)
			let rolledBack = false
			const finish = (rollback: boolean) => {
				if (rollback) db.exec(`ROLLBACK TO ${name}`)
				db.exec(`RELEASE ${name}`)
			}
			try {
				const result = await closure({ rollback: () => void (rolledBack = true) })
				finish(rolledBack)
				return result
			} catch (error) {
				finish(true)
				throw error
			}
		},
		getAlarm: async () => alarm,
		setAlarm: async (time) => void (alarm = time),
		deleteAlarm: async () => void (alarm = null),
		alarm: () => alarm,
	}
}

/** The object's effect `SqlClient` (`@effect/sql-sqlite-do`) over a fake storage. */
export const sqliteClientLayer = (storage: FakeStorage): Layer.Layer<SqliteDo.SqliteClient | SqlClient> =>
	SqliteDo.layer({ storage: storage as never })

export interface FakeSocket extends SyncSocket {
	readyState: number
	readonly sent: Array<string>
	closed: { readonly code: number | undefined; readonly reason: string | undefined } | undefined
	tags: ReadonlyArray<string>
	/** Sent frames, parsed. */
	frames(): Array<{ readonly _tag: string } & Record<string, unknown>>
	/** Drop recorded frames. */
	clear(): void
}

export const makeFakeSocket = (): FakeSocket => {
	let attachment: unknown = null
	const socket: FakeSocket = {
		readyState: 1,
		sent: [],
		closed: undefined,
		tags: [],
		send(data) {
			if (socket.readyState !== 1) throw new Error("socket is not open")
			socket.sent.push(data)
		},
		close(code, reason) {
			if (socket.closed !== undefined) return
			socket.readyState = 3
			socket.closed = { code, reason }
		},
		// Structured clone, as workerd does: no shared references survive.
		serializeAttachment: (value) => void (attachment = structuredClone(value)),
		deserializeAttachment: () => structuredClone(attachment),
		frames: () => socket.sent.map((frame) => JSON.parse(frame)),
		clear: () => void socket.sent.splice(0),
	}
	return socket
}

export const makeFakeState = (): SyncObjectState & { readonly sockets: Array<FakeSocket> } => {
	const sockets: Array<FakeSocket> = []
	return {
		sockets,
		acceptWebSocket(socket, tags) {
			const fake = socket as FakeSocket
			fake.tags = tags ?? []
			sockets.push(fake)
		},
		getWebSockets: (tag) =>
			sockets.filter(
				(socket) => socket.readyState === 1 && (tag === undefined || socket.tags.includes(tag)),
			),
	}
}
