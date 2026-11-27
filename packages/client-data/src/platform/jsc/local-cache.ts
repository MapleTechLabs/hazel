/**
 * The local cache on iOS: TanStack DB's SQLite persistence and the channels' kept states over the
 * app's own SQLite (`__native.sqlite`, files in Application Support), behind the same
 * `LocalCacheHost` the web's cache takes from a native app (`../web/local-cache-host.ts`).
 *
 * One process holds the files, so there is no lock or scratch file as in a browser tab. One user per
 * runtime: binding another user, or binding after `forget`, refuses every query until the shell
 * starts a new runtime, so no row of one user reaches another's file.
 */
import {
	type BrowserWASQLiteDatabase,
	createBrowserWASQLitePersistence,
	persistedCollectionOptions,
} from "@tanstack/browser-db-sqlite-persistence"
import type { SourceSnapshot, SourceSnapshotStore } from "@hazel/effect-db-collection"
import type { UserId } from "@hazel/schema"
import { Layer } from "effect"
import { LocalCache, type PersistOptions } from "../services"
import { hostFileOf, makeChannelSnapshots, openHostBackend } from "../web/channel-snapshots"
import type { LocalCacheHost } from "../web/local-cache-host"
import { type NativeBridge, type NativeSqlValue, nativeBridge } from "./bridge"

type Sqlite = NonNullable<NativeBridge["sqlite"]>

const sqlValue = (value: unknown): NativeSqlValue => {
	if (value === undefined || value === null) return null
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value
	if (typeof value === "bigint") return Number(value)
	if (value instanceof Uint8Array) return value
	if (value instanceof ArrayBuffer) return new Uint8Array(value)
	throw new TypeError(`SQLite takes no ${Object.prototype.toString.call(value)} parameter`)
}

const databaseOf = (sqlite: Sqlite, handle: number): BrowserWASQLiteDatabase => ({
	execute: <TRow>(sql: string, params: ReadonlyArray<unknown> = []) =>
		new Promise<ReadonlyArray<TRow>>((resolve, reject) => {
			sqlite.execute(handle, sql, params.map(sqlValue), (rows, error) => {
				if (rows === null) {
					reject(new Error(error ?? "SQLite failed"))
					return
				}
				// SAFETY: Swift answers an array of row objects; TanStack's driver names the row type it reads.
				const parsed = JSON.parse(rows) as ReadonlyArray<TRow>
				resolve(parsed)
			})
		}),
	close: () => new Promise<void>((resolve) => sqlite.close(handle, resolve)),
})

/** A `LocalCacheHost` over the app's SQLite. */
export const makeSqliteHost = (sqlite: Sqlite): LocalCacheHost => ({
	open: (name) =>
		new Promise((resolve, reject) =>
			sqlite.open(name, (handle, error) =>
				handle === null
					? reject(new Error(error ?? `Could not open ${name}`))
					: resolve(databaseOf(sqlite, handle)),
			),
		),
	remove: (name) =>
		new Promise((resolve, reject) =>
			sqlite.remove(name, (error) => (error === null ? resolve() : reject(new Error(error)))),
		),
})

const FILE_PREFIX = "hazel-cache-"
const fileOf = (userId: UserId) => `${FILE_PREFIX}${userId}.sqlite`

/** The cache over `host`: persistence for the collections, the channels' states, `bind` and `forget`. */
export const makeNativeLocalCache = (host: LocalCacheHost) => {
	let bound: { readonly userId: UserId; readonly file: Promise<BrowserWASQLiteDatabase> } | undefined
	/** Another user, or a bind after `forget`: nothing more is read or written in this runtime. */
	let refused = false
	let resolveDatabase: (database: Promise<BrowserWASQLiteDatabase>) => void = () => {}
	const database = new Promise<BrowserWASQLiteDatabase>((resolve) => {
		resolveDatabase = resolve
	})
	const refusal = () =>
		Promise.reject(new Error("[local-cache] this runtime's cache is closed; start a new one"))

	const persistence = createBrowserWASQLitePersistence({
		database: {
			execute: (sql, params) => (refused ? refusal() : database.then((db) => db.execute(sql, params))),
		},
	})
	const persist: PersistOptions = (schemaVersion) => (options) =>
		persistedCollectionOptions({
			...(options as typeof options & Parameters<typeof persistedCollectionOptions>[0]),
			persistence,
			schemaVersion,
		})

	const channels = makeChannelSnapshots(
		(userId) => openHostBackend(host, userId),
		async (userId) => {
			if (userId !== undefined) await host.remove(hostFileOf(userId))
		},
	)

	const bind = (userId: UserId): void => {
		if (bound !== undefined) {
			if (bound.userId !== userId) {
				refused = true
				console.error(
					"[local-cache] another user in the same runtime: the cache is closed until it restarts",
				)
			}
			return
		}
		if (refused) return
		channels.bind(userId)
		const file = host.open(fileOf(userId))
		bound = { userId, file }
		resolveDatabase(file)
	}

	const forget = async (userId?: UserId): Promise<boolean> => {
		const wasOpen = bound
		refused = true
		const user = wasOpen?.userId ?? userId
		const removeFile = async () => {
			if (wasOpen !== undefined) await (await wasOpen.file.catch(() => undefined))?.close?.()
			if (user !== undefined) await host.remove(fileOf(user))
		}
		const results = await Promise.allSettled([channels.forget(userId), removeFile()])
		for (const result of results)
			if (result.status === "rejected")
				console.error("[local-cache] Could not delete the cache", result.reason)
		return wasOpen !== undefined
	}

	return LocalCache.of({ persist, snapshots: channels.store, bind, forget })
}

/** G3's stand-in on a host with no SQLite: channel states in memory, persistence off. */
const memorySnapshots = (): SourceSnapshotStore => {
	const kept = new Map<string, SourceSnapshot>()
	return {
		keeps: () => true,
		keepsTable: (table) => table !== "typing_indicators",
		read: async (source) => kept.get(source),
		write: async (source, snapshot) => void kept.set(source, snapshot),
		remove: async (source) => void kept.delete(source),
	}
}

export const LocalCacheJsc = Layer.sync(LocalCache, () => {
	const { sqlite } = nativeBridge()
	if (sqlite !== undefined) return makeNativeLocalCache(makeSqliteHost(sqlite))
	return LocalCache.of({
		persist: undefined,
		snapshots: memorySnapshots(),
		bind: () => {},
		forget: async () => false,
	})
})
