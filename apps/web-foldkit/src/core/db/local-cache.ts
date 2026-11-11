/**
 * The synced rows kept on disk between loads (TanStack DB's SQLite persistence: wa-sqlite on
 * OPFS), so a persisted collection shows last session's rows before its sources answer.
 *
 * Opt-in while it is tried out: `localStorage["hazel:local-cache"] = "on"`, then reload. One
 * database file per user; it opens once the session's user is known (`bindLocalCache`), and the
 * persisted collections start syncing only then.
 */
import {
	type BrowserWASQLiteDatabase,
	createBrowserWASQLitePersistence,
	openBrowserWASQLiteOPFSDatabase,
	type PersistedCollectionPersistence,
} from "@tanstack/browser-db-sqlite-persistence"
import type { UserId } from "@hazel/schema"

const FLAG_KEY = "hazel:local-cache"

const isEnabled = (): boolean => {
	try {
		return (
			globalThis.localStorage?.getItem(FLAG_KEY) === "on" &&
			typeof Worker !== "undefined" &&
			typeof navigator.storage?.getDirectory === "function"
		)
	} catch {
		return false
	}
}

let boundUser: UserId | undefined
let resolveDatabase: (database: Promise<BrowserWASQLiteDatabase>) => void = () => {}
const database = new Promise<BrowserWASQLiteDatabase>((resolve) => {
	resolveDatabase = resolve
})

/** The persistence of the collections kept on disk; `undefined` while the cache is off. */
export const localCachePersistence: PersistedCollectionPersistence | undefined = isEnabled()
	? createBrowserWASQLitePersistence({
			database: { execute: (sql, params) => database.then((db) => db.execute(sql, params)) },
		})
	: undefined

/**
 * Opens `userId`'s cache. A different user later in the same page reloads it: the open
 * collections hold the first user's file, and no row may reach another user.
 */
export const bindLocalCache = (userId: UserId): void => {
	if (localCachePersistence === undefined) return
	if (boundUser !== undefined) {
		if (boundUser !== userId) window.location.reload()
		return
	}
	boundUser = userId
	resolveDatabase(
		openBrowserWASQLiteOPFSDatabase({ databaseName: `hazel-cache-${userId}.sqlite` }).catch(
			(cause: unknown) => {
				// The persisted collections cannot run without their file: turn the cache off and start over.
				console.error("[local-cache] Could not open the cache; turning it off", cause)
				globalThis.localStorage?.removeItem(FLAG_KEY)
				window.location.reload()
				return new Promise<never>(() => {})
			},
		),
	)
}
