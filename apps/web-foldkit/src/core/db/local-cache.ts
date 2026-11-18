/**
 * The synced rows kept on disk between loads (TanStack DB's SQLite persistence), so a persisted
 * collection shows last session's rows before its sources answer. In a browser the database is
 * wa-sqlite on OPFS; the native apps keep SQLite themselves (`./local-cache-host.ts`).
 *
 * One database file per user. It opens once the user is known (`bindLocalCache`), which with a
 * remembered user (`app/remembered-user.ts`) is before any request, and the persisted collections
 * start syncing only then. It is deleted when the session ends (`forgetLocalCache`). The channels'
 * last states are kept beside it (`./channel-snapshots.ts`), under the same two calls.
 *
 * One tab per user holds the file (a Web Lock, for as long as the tab lives). Each tab runs its own
 * sync, and two writers could leave a row older than the seq stored for its source, so any other
 * tab of that user works on a scratch file of its own: it starts empty and is deleted later.
 *
 * `localStorage["hazel:local-cache"] = "off"` turns the cache off. When the file cannot be opened
 * the app turns it off itself, for a day.
 */
import {
	type BrowserWASQLiteDatabase,
	createBrowserWASQLitePersistence,
	openBrowserWASQLiteOPFSDatabase,
	type PersistedCollectionPersistence,
} from "@tanstack/browser-db-sqlite-persistence"
import type { UserId } from "@hazel/schema"
import { makeAppChannelSnapshots } from "./channel-snapshots"
import { localCacheHost } from "./local-cache-host"

const FLAG_KEY = "hazel:local-cache"

/**
 * wa-sqlite cannot open a database whose file name is longer than 56 characters (64 with its
 * `-journal` suffix); a user's file is 55.
 */
const FILE_PREFIX = "hazel-cache-"
const fileOf = (userId: UserId) => `${FILE_PREFIX}${userId}.sqlite`
const scratchFile = () => `${FILE_PREFIX}tab-${crypto.randomUUID().slice(0, 13)}.sqlite`

const hasOpfs = () => typeof Worker !== "undefined" && typeof navigator.storage?.getDirectory === "function"

/** How long the cache stays off after it could not be opened, before a load tries it again. */
const RETRY_AFTER_MS = 24 * 60 * 60 * 1000
const FAILED = /^failed:(\d+)$/

/** `localStorage`, and `sessionStorage` for a failure `localStorage` had no room to record. */
const flagStores = (): ReadonlyArray<Storage> =>
	[globalThis.localStorage, globalThis.sessionStorage].filter((store) => store !== undefined)

/** Off while a store says `off` (the user's, for good) or `failed:<ms>` (the app's, since a failed open). */
const isOn = (): boolean => {
	try {
		return flagStores().every((store) => {
			const flag = store.getItem(FLAG_KEY)
			const failedAt = FAILED.exec(flag ?? "")?.[1]
			return (
				flag !== "off" && (failedAt === undefined || Date.now() - Number(failedAt) >= RETRY_AFTER_MS)
			)
		})
	} catch {
		return false
	}
}

/** Records a failed open; whether any store took it (without it, a reload would only fail again). */
const turnOffAfterFailure = (): boolean =>
	flagStores().some((store) => {
		try {
			store.setItem(FLAG_KEY, `failed:${Date.now()}`)
			return true
		} catch {
			return false
		}
	})

const openDatabase = (databaseName: string): Promise<BrowserWASQLiteDatabase> =>
	localCacheHost()?.open(databaseName) ?? openBrowserWASQLiteOPFSDatabase({ databaseName })

/** SQLite's own side files beside a database. */
const filesOf = (databaseName: string) => [databaseName, `${databaseName}-journal`, `${databaseName}-wal`]

const removeDatabase = async (databaseName: string): Promise<void> => {
	const host = localCacheHost()
	if (host !== undefined) return host.remove(databaseName)
	const root = await navigator.storage.getDirectory()
	await Promise.all(
		// A file that is not there is the outcome asked for.
		filesOf(databaseName).map((name) => root.removeEntry(name).catch(() => {})),
	)
}

/**
 * Deletes every cache file but `keep` that no tab holds: the scratch files of tabs that are gone,
 * and the file of a user whose session ended while the tab holding it could not delete it. With
 * no `keep` (the session ended) none may stay.
 */
const removeStaleFiles = async (keep?: string): Promise<void> => {
	const root = await navigator.storage.getDirectory()
	const held = new Set((await navigator.locks.query()).held?.map((lock) => lock.name))
	const stale: Array<string> = []
	for await (const name of root.keys()) {
		const database = name.replace(/-(journal|wal)$/, "")
		if (database.startsWith(FILE_PREFIX) && database !== keep && !held.has(database)) stale.push(name)
	}
	await Promise.all(stale.map((name) => root.removeEntry(name).catch(() => {})))
}

/** Holds the Web Lock `name` until the page goes; whether this tab got it. */
const holdLock = (name: string): Promise<boolean> =>
	new Promise((resolve) => {
		void navigator.locks.request(name, { ifAvailable: true }, (lock) => {
			resolve(lock !== null)
			return lock === null ? undefined : new Promise<never>(() => {})
		})
	})

interface OpenCache {
	readonly file: string
	readonly database: BrowserWASQLiteDatabase
}

const open = async (file: string): Promise<OpenCache> => ({ file, database: await openDatabase(file) })

/**
 * The database this tab works on: the user's file when no other tab holds it, else a scratch
 * file. A host's database has one process, and a browser without Web Locks cannot tell: both get
 * the user's file.
 */
const openFor = async (userId: UserId): Promise<OpenCache> => {
	const file = fileOf(userId)
	if (localCacheHost() !== undefined || typeof navigator.locks?.request !== "function") return open(file)
	if (await holdLock(file)) {
		void removeStaleFiles(file).catch(() => {})
		return open(file)
	}
	const scratch = scratchFile()
	await holdLock(scratch)
	return open(scratch)
}

let boundUser: UserId | undefined
/** The open file went (`forgetLocalCache`): the collections holding it need a new page. */
let isForgotten = false
let opened: Promise<OpenCache> | undefined
let resolveDatabase: (database: Promise<BrowserWASQLiteDatabase>) => void = () => {}
const database = new Promise<BrowserWASQLiteDatabase>((resolve) => {
	resolveDatabase = resolve
})

/** The persistence of the collections kept on disk; `undefined` while the cache is off. */
export const localCachePersistence: PersistedCollectionPersistence | undefined =
	isOn() && (localCacheHost() !== undefined || hasOpfs())
		? createBrowserWASQLitePersistence({
				database: { execute: (sql, params) => database.then((db) => db.execute(sql, params)) },
			})
		: undefined

/** The channels' kept states (`./channel-snapshots.ts`); `undefined` while the cache is off. */
export const channelSnapshots = isOn() ? makeAppChannelSnapshots() : undefined

/**
 * Opens `userId`'s cache. A different user later in the same page reloads it: the open
 * collections hold the first user's file, and no row may reach another user.
 */
export const bindLocalCache = (userId: UserId): void => {
	channelSnapshots?.bind(userId)
	if (localCachePersistence === undefined) return
	if (boundUser !== undefined) {
		if (boundUser !== userId || isForgotten) window.location.reload()
		return
	}
	boundUser = userId
	// The database's worker ends when the page is hidden for the back/forward cache: a page
	// restored from it holds collections over a connection that is gone.
	if (localCacheHost() === undefined) {
		window.addEventListener?.("pageshow", (event) => {
			if (event.persisted) window.location.reload()
		})
	}
	opened = openFor(userId).catch((cause: unknown) => {
		// The persisted collections cannot run without their file: turn the cache off and start over.
		console.error("[local-cache] Could not open the cache; turning it off", cause)
		if (turnOffAfterFailure()) {
			window.location.reload()
			return new Promise<never>(() => {})
		}
		// Not recorded, so a reload would only fail again: the collections fail, and sign-out still
		// gets past this file.
		throw cause
	})
	resolveDatabase(opened.then((cache) => cache.database))
}

/**
 * The session ended: deletes what is kept of the bound user, or of `userId` (the remembered user)
 * when the cache was never opened in this page, and every cache file no tab holds. A file another
 * tab holds is deleted by that tab when it learns the same (`app/subscription.ts` hears the
 * remembered user go), or by the next tab to hold one. Whether a file was open here, in which case
 * the collections still hold its rows in memory and the page must load again.
 */
export const forgetLocalCache = async (userId?: UserId): Promise<boolean> => {
	if (isForgotten) return false
	const wasOpen = opened
	if (wasOpen !== undefined) isForgotten = true
	const user = boundUser ?? userId
	const removeFiles = async () => {
		if (wasOpen !== undefined) {
			const { file, database: db } = await wasOpen
			await db.close?.()
			await removeDatabase(file)
		}
		if (localCacheHost() !== undefined || typeof navigator.locks?.query !== "function") {
			if (user !== undefined) await removeDatabase(fileOf(user))
		} else if (hasOpfs()) await removeStaleFiles()
	}
	// Neither waits on the other: a store one cannot delete must not keep the other on disk.
	const results = await Promise.allSettled([channelSnapshots?.forget(userId), removeFiles()])
	for (const result of results) {
		if (result.status === "rejected")
			console.error("[local-cache] Could not delete the cache", result.reason)
	}
	return wasOpen !== undefined
}
