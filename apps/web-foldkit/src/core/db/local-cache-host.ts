/**
 * A host that keeps SQLite itself opens the local cache's database here, in place of wa-sqlite on
 * OPFS: the native apps set `globalThis.__hazelLocalCacheHost` before the app's modules load.
 */
import type { BrowserWASQLiteDatabase } from "@tanstack/browser-db-sqlite-persistence"

export interface LocalCacheHost {
	/** Opens the database `databaseName`, creating it when there is none. */
	readonly open: (databaseName: string) => Promise<BrowserWASQLiteDatabase>
	/** Deletes the database `databaseName` with its side files; resolves when none is left. */
	readonly remove: (databaseName: string) => Promise<void>
}

declare global {
	var __hazelLocalCacheHost: LocalCacheHost | undefined
}

export const localCacheHost = (): LocalCacheHost | undefined => globalThis.__hazelLocalCacheHost
