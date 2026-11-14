import { UserId } from "@hazel/schema"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const persistence = {
	open: vi.fn<(options: { readonly databaseName: string }) => Promise<unknown>>(),
	create: vi.fn((options: { readonly database: unknown }) => ({ options })),
}

const userA = UserId.make("00000000-0000-4000-8000-000000000001")
const userB = UserId.make("00000000-0000-4000-8000-000000000002")
const fileA = `hazel-cache-${userA}.sqlite`

const storage = new Map<string, string>()
const reload = vi.fn()
/** OPFS root entries, and the Web Locks other tabs hold. */
const files = new Set<string>()
const locksHeldElsewhere = new Set<string>()
const locksHeldHere = new Set<string>()

/** The module reads the flag once, when it loads. */
const loadModule = async (flag?: string) => {
	storage.clear()
	if (flag !== undefined) storage.set("hazel:local-cache", flag)
	vi.resetModules()
	vi.doMock("@tanstack/browser-db-sqlite-persistence", () => ({
		openBrowserWASQLiteOPFSDatabase: persistence.open,
		createBrowserWASQLitePersistence: persistence.create,
	}))
	return import("./local-cache")
}

/** The database handle the persistence was created with. */
const databaseOf = () =>
	(
		persistence.create.mock.calls[0]![0] as {
			readonly database: { readonly execute: (sql: string) => Promise<unknown> }
		}
	).database

const openedFiles = () => persistence.open.mock.calls.map(([options]) => options.databaseName)

beforeEach(() => {
	persistence.open.mockReset()
	persistence.create.mockClear()
	reload.mockClear()
	files.clear()
	locksHeldElsewhere.clear()
	locksHeldHere.clear()
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => void storage.set(key, value),
		removeItem: (key: string) => storage.delete(key),
	})
	vi.stubGlobal("Worker", class {})
	vi.stubGlobal("navigator", {
		storage: {
			getDirectory: async () => ({
				removeEntry: async (name: string) => void files.delete(name),
				keys: async function* () {
					yield* [...files]
				},
			}),
		},
		locks: {
			request: async (
				name: string,
				_options: unknown,
				callback: (lock: { readonly name: string } | null) => Promise<unknown> | undefined,
			) => {
				if (locksHeldElsewhere.has(name)) return callback(null)
				locksHeldHere.add(name)
				return callback({ name })
			},
			query: async () => ({
				held: [...locksHeldElsewhere, ...locksHeldHere].map((name) => ({ name })),
			}),
		},
	})
	vi.stubGlobal("window", { location: { reload } })
})

afterEach(() => {
	vi.unstubAllGlobals()
})

describe("local cache", () => {
	it("is off once turned off", async () => {
		const cache = await loadModule("off")
		expect(cache.localCachePersistence).toBeUndefined()
		cache.bindLocalCache(userA)
		expect(persistence.open).not.toHaveBeenCalled()
		expect(reload).not.toHaveBeenCalled()
	})

	it("is off where the browser has no OPFS", async () => {
		vi.stubGlobal("navigator", {})
		const cache = await loadModule()
		expect(cache.localCachePersistence).toBeUndefined()
	})

	it("is on where the browser has OPFS: opens the user's own file, and only once it is bound", async () => {
		const execute = vi.fn(async () => [{ ok: 1 }])
		persistence.open.mockResolvedValue({ execute })
		const cache = await loadModule()
		const query = databaseOf().execute("SELECT 1")
		expect(persistence.open).not.toHaveBeenCalled()

		cache.bindLocalCache(userA)
		await expect(query).resolves.toEqual([{ ok: 1 }])
		expect(openedFiles()).toEqual([fileA])
		cache.bindLocalCache(userA)
		expect(persistence.open).toHaveBeenCalledTimes(1)
		expect(reload).not.toHaveBeenCalled()
	})

	it("works on a scratch file while another tab holds the user's", async () => {
		persistence.open.mockResolvedValue({ execute: async () => [] })
		locksHeldElsewhere.add(fileA)
		const cache = await loadModule()
		cache.bindLocalCache(userA)
		await databaseOf().execute("SELECT 1")
		expect(openedFiles()).toEqual([expect.stringMatching(/^hazel-cache-tab-.+\.sqlite$/)])
		// wa-sqlite opens no longer name (`restore.browser.test.ts` opens one of this length).
		expect(Math.max(fileA.length, ...openedFiles().map((name) => name.length))).toBeLessThanOrEqual(56)
	})

	it("deletes the files no tab holds when it takes the user's file", async () => {
		persistence.open.mockResolvedValue({ execute: async () => [] })
		const openScratch = "hazel-cache-tab-open.sqlite"
		locksHeldElsewhere.add(openScratch)
		for (const name of [
			fileA,
			`${fileA}-journal`,
			openScratch,
			"hazel-cache-tab-gone.sqlite",
			"hazel-cache-tab-gone.sqlite-journal",
			`hazel-cache-${userB}.sqlite`,
			"unrelated.txt",
		])
			files.add(name)
		const cache = await loadModule()
		cache.bindLocalCache(userA)
		await databaseOf().execute("SELECT 1")
		await vi.waitFor(() =>
			expect([...files].sort()).toEqual(
				[fileA, `${fileA}-journal`, openScratch, "unrelated.txt"].sort(),
			),
		)
	})

	it("reloads when another user signs in on the same page", async () => {
		persistence.open.mockResolvedValue({ execute: async () => [] })
		const cache = await loadModule()
		cache.bindLocalCache(userA)
		cache.bindLocalCache(userB)
		expect(reload).toHaveBeenCalledTimes(1)
	})

	it("turns itself off and reloads when the file cannot open", async () => {
		persistence.open.mockRejectedValue(new Error("OPFS unavailable"))
		vi.spyOn(console, "error").mockImplementation(() => {})
		const cache = await loadModule()
		cache.bindLocalCache(userA)
		await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
		expect(storage.get("hazel:local-cache")).toBe("off")
	})

	it("reloads a page restored from the back/forward cache: its database connection is gone", async () => {
		persistence.open.mockResolvedValue({ execute: async () => [] })
		const listeners = new Map<string, (event: { readonly persisted: boolean }) => void>()
		vi.stubGlobal("window", {
			location: { reload },
			addEventListener: (type: string, listener: (event: { readonly persisted: boolean }) => void) =>
				void listeners.set(type, listener),
		})
		const cache = await loadModule()
		cache.bindLocalCache(userA)
		listeners.get("pageshow")?.({ persisted: false })
		expect(reload).not.toHaveBeenCalled()
		listeners.get("pageshow")?.({ persisted: true })
		expect(reload).toHaveBeenCalledTimes(1)
	})

	it("forgets nothing while no file is open", async () => {
		const cache = await loadModule()
		await expect(cache.forgetLocalCache()).resolves.toBe(false)
	})

	it("closes and deletes the user's file when the session ends, and a later sign-in reloads", async () => {
		const close = vi.fn()
		persistence.open.mockResolvedValue({ execute: async () => [], close })
		files.add(fileA).add(`${fileA}-journal`)
		const cache = await loadModule()
		cache.bindLocalCache(userA)
		await databaseOf().execute("SELECT 1")

		await expect(cache.forgetLocalCache()).resolves.toBe(true)
		expect(close).toHaveBeenCalledTimes(1)
		expect([...files]).toEqual([])
		await expect(cache.forgetLocalCache()).resolves.toBe(false)
		cache.bindLocalCache(userA)
		expect(reload).toHaveBeenCalledTimes(1)
	})

	it("opens and deletes through the host that keeps SQLite itself", async () => {
		const host = {
			open: vi.fn(async () => ({ execute: async () => [{ ok: 1 }] })),
			remove: vi.fn(async () => {}),
		}
		vi.stubGlobal("__hazelLocalCacheHost", host)
		// No OPFS: the host alone turns the cache on.
		vi.stubGlobal("navigator", {})
		const cache = await loadModule()
		cache.bindLocalCache(userA)
		await expect(databaseOf().execute("SELECT 1")).resolves.toEqual([{ ok: 1 }])
		expect(host.open).toHaveBeenCalledWith(fileA)
		expect(persistence.open).not.toHaveBeenCalled()
		await cache.forgetLocalCache()
		expect(host.remove).toHaveBeenCalledWith(fileA)
	})
})
