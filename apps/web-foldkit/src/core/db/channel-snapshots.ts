/**
 * The last state of the channels the user had open, kept between loads: opening a channel shows
 * its messages as they were while its source is still answering (a cold channel object takes about
 * a second), and the source's own snapshot then replaces them (`@hazel/effect-db-collection`'s
 * `SourceSnapshotStore`). Part of the local cache (`./local-cache.ts`): one store per user, opened
 * and deleted with it.
 *
 * IndexedDB in a browser; a host that keeps SQLite itself (the native apps) stores them there.
 * Several tabs may write the same channel: each record is one whole state, and none is resumed from.
 */
import { SyncSeq, SyncWindow } from "@hazel/domain/sync"
import type { SourceKey, SourceSnapshot, SourceSnapshotStore } from "@hazel/effect-db-collection"
import type { UserId } from "@hazel/schema"
import { Option, Schema } from "effect"
import { type LocalCacheHost, localCacheHost } from "./local-cache-host"

/** Channels kept per user: the most recently open ones. */
export const MAX_KEPT_CHANNELS = 40

const Snapshot = Schema.Struct({
	seq: SyncSeq,
	tables: Schema.Record(Schema.String, Schema.Array(Schema.Unknown)),
	windows: Schema.Array(SyncWindow),
})
/** An IndexedDB record; its other fields are the key and the index. */
const decodeRecord = Schema.decodeUnknownOption(Schema.Struct({ snapshot: Snapshot }))
const decodeSnapshotJson = Schema.decodeUnknownOption(Schema.fromJsonString(Snapshot))

/** One user's kept states. */
export interface SnapshotBackend {
	readonly get: (source: SourceKey) => Promise<SourceSnapshot | undefined>
	/** Stores `snapshot`, and drops the least recently stored past {@link MAX_KEPT_CHANNELS}. */
	readonly put: (source: SourceKey, snapshot: SourceSnapshot) => Promise<void>
	readonly remove: (source: SourceKey) => Promise<void>
	/** Closes the store and deletes everything in it. */
	readonly destroy: () => Promise<void>
}

// IndexedDB

const IDB_PREFIX = "hazel-channels-"
const IDB_STORE = "snapshots"
const IDB_SAVED_AT = "savedAt"

const requestOf = <T>(request: IDBRequest<T>): Promise<T> =>
	new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error)
	})

const committed = (transaction: IDBTransaction): Promise<void> =>
	new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve()
		transaction.onerror = () => reject(transaction.error)
		transaction.onabort = () => reject(transaction.error)
	})

/** Deletes the database once every tab has let go of it (`onversionchange` below); does not wait for that. */
const deleteIdb = (name: string): Promise<void> =>
	new Promise((resolve, reject) => {
		const request = indexedDB.deleteDatabase(name)
		request.onsuccess = () => resolve()
		request.onblocked = () => resolve()
		request.onerror = () => reject(request.error)
	})

export const openIdbBackend = async (userId: UserId): Promise<SnapshotBackend> => {
	const name = `${IDB_PREFIX}${userId}`
	const opening = indexedDB.open(name, 1)
	opening.onupgradeneeded = () => {
		opening.result
			.createObjectStore(IDB_STORE, { keyPath: "source" })
			.createIndex(IDB_SAVED_AT, IDB_SAVED_AT)
	}
	const db = await requestOf(opening)
	// Another tab is deleting the store (the session ended there): let go of it.
	db.onversionchange = () => db.close()
	return {
		get: async (source) => {
			const record: unknown = await requestOf(
				db.transaction(IDB_STORE).objectStore(IDB_STORE).get(source),
			)
			return Option.getOrUndefined(decodeRecord(record))?.snapshot
		},
		put: async (source, snapshot) => {
			const transaction = db.transaction(IDB_STORE, "readwrite")
			const store = transaction.objectStore(IDB_STORE)
			store.put({ source, savedAt: Date.now(), snapshot })
			let excess = (await requestOf(store.count())) - MAX_KEPT_CHANNELS
			if (excess > 0) {
				// Oldest first.
				const cursor = store.index(IDB_SAVED_AT).openKeyCursor()
				cursor.onsuccess = () => {
					const at = cursor.result
					if (at === null || excess <= 0) return
					store.delete(at.primaryKey)
					excess--
					at.continue()
				}
			}
			await committed(transaction)
		},
		remove: async (source) => {
			const transaction = db.transaction(IDB_STORE, "readwrite")
			transaction.objectStore(IDB_STORE).delete(source)
			await committed(transaction)
		},
		destroy: async () => {
			db.close()
			await deleteIdb(name)
		},
	}
}

/**
 * Deletes the stores of every user but `keep`: sessions that ended without this tab hearing. With
 * no `keep` (the session ended) none may stay.
 */
const removeIdbStores = async (keep?: UserId): Promise<void> => {
	// Not in every browser; where it is missing, those stores stay until their user's next sign-out.
	const databases = (await indexedDB.databases?.()) ?? []
	await Promise.all(
		databases.flatMap(({ name }) =>
			name !== undefined && name.startsWith(IDB_PREFIX) && name !== `${IDB_PREFIX}${keep}`
				? [deleteIdb(name)]
				: [],
		),
	)
}

// The host's SQLite

/** At most 56 characters (`./local-cache.ts`). */
const hostFileOf = (userId: UserId) => `hazel-chans-${userId}.sqlite`

export const openHostBackend = async (host: LocalCacheHost, userId: UserId): Promise<SnapshotBackend> => {
	const file = hostFileOf(userId)
	const db = await host.open(file)
	await db.execute(
		"CREATE TABLE IF NOT EXISTS snapshots (source TEXT PRIMARY KEY, saved_at INTEGER NOT NULL, snapshot TEXT NOT NULL)",
	)
	return {
		get: async (source) => {
			const rows = await db.execute<{ readonly snapshot?: unknown }>(
				"SELECT snapshot FROM snapshots WHERE source = ?",
				[source],
			)
			return Option.getOrUndefined(decodeSnapshotJson(rows[0]?.snapshot))
		},
		put: async (source, snapshot) => {
			await db.execute(
				"INSERT OR REPLACE INTO snapshots (source, saved_at, snapshot) VALUES (?, ?, ?)",
				[source, Date.now(), JSON.stringify(snapshot)],
			)
			await db.execute(
				"DELETE FROM snapshots WHERE source NOT IN (SELECT source FROM snapshots ORDER BY saved_at DESC LIMIT ?)",
				[MAX_KEPT_CHANNELS],
			)
		},
		remove: async (source) => {
			await db.execute("DELETE FROM snapshots WHERE source = ?", [source])
		},
		destroy: async () => {
			await db.close?.()
			await host.remove(file)
		},
	}
}

// The store

export interface ChannelSnapshots {
	readonly store: SourceSnapshotStore
	/** Opens `userId`'s states; until then reads wait and writes are dropped. */
	readonly bind: (userId: UserId) => void
	/**
	 * The session ended: deletes the bound user's states, `userId`'s (the remembered user), and
	 * every other store left behind. With none bound, a later `bind` opens a new store.
	 */
	readonly forget: (userId?: UserId) => Promise<void>
}

/**
 * `open`: a user's backend. `destroyRest`: deletes the states no open backend holds, `userId`'s
 * (the remembered user) among them.
 */
export const makeChannelSnapshots = (
	open: (userId: UserId) => Promise<SnapshotBackend>,
	destroyRest: (userId?: UserId) => Promise<void>,
): ChannelSnapshots => {
	let bound: { readonly userId: UserId; readonly backend: Promise<SnapshotBackend | undefined> } | undefined
	let isForgotten = false
	let resolveBackend: (backend: Promise<SnapshotBackend | undefined>) => void = () => {}
	/** Settles once a user is bound: a channel opened before that waits for its kept state. */
	const backend = new Promise<SnapshotBackend | undefined>((resolve) => {
		resolveBackend = resolve
	})
	const current = () => (isForgotten ? Promise.resolve(undefined) : backend)
	return {
		store: {
			keeps: (source) => source.startsWith("channel:"),
			// Who is typing means nothing a load later.
			keepsTable: (table) => table !== "typing_indicators",
			read: async (source) => (await current())?.get(source),
			write: async (source, snapshot) => {
				// Nothing is stored for a user who is not known yet.
				if (bound === undefined || isForgotten) return
				await (await bound.backend)?.put(source, snapshot)
			},
			remove: async (source) => {
				if (bound === undefined || isForgotten) return
				await (await bound.backend)?.remove(source)
			},
		},
		bind: (userId) => {
			if (bound !== undefined) return
			const opened = open(userId).catch((cause: unknown) => {
				console.error("[local-cache] Could not open the channel states", cause)
				return undefined
			})
			bound = { userId, backend: opened }
			resolveBackend(opened)
		},
		forget: async (userId) => {
			try {
				if (bound !== undefined) {
					// The open store is gone for this page: nothing more is read from or written to it.
					isForgotten = true
					await (await bound.backend)?.destroy()
				}
				await destroyRest(userId)
			} catch (cause) {
				console.error("[local-cache] Could not delete the channel states", cause)
			}
		},
	}
}

/** The app's store, or `undefined` where nothing can hold it. */
export const makeAppChannelSnapshots = (): ChannelSnapshots | undefined => {
	const host = localCacheHost()
	if (host !== undefined) {
		return makeChannelSnapshots(
			(userId) => openHostBackend(host, userId),
			async (userId) => {
				if (userId !== undefined) await host.remove(hostFileOf(userId))
			},
		)
	}
	if (typeof indexedDB === "undefined") return undefined
	return makeChannelSnapshots(
		async (userId) => {
			void removeIdbStores(userId).catch(() => {})
			return openIdbBackend(userId)
		},
		async (userId) => {
			// By name too: not every browser lists its databases.
			await Promise.all([
				removeIdbStores(),
				...(userId === undefined ? [] : [deleteIdb(`${IDB_PREFIX}${userId}`)]),
			])
		},
	)
}
