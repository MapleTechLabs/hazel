import { UserId } from "@hazel/schema"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const persistence = {
	open: vi.fn<(options: { readonly databaseName: string }) => Promise<unknown>>(),
	create: vi.fn((options: { readonly database: unknown }) => ({ options })),
}

const userA = UserId.make("00000000-0000-4000-8000-000000000001")
const userB = UserId.make("00000000-0000-4000-8000-000000000002")

const storage = new Map<string, string>()
const reload = vi.fn()

/** The module reads the flag once, when it loads. */
const loadModule = async (flag: string | undefined) => {
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
	(persistence.create.mock.calls[0]![0] as { readonly database: { readonly execute: (sql: string) => Promise<unknown> } })
		.database

beforeEach(() => {
	persistence.open.mockReset()
	persistence.create.mockClear()
	reload.mockClear()
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => storage.get(key) ?? null,
		removeItem: (key: string) => storage.delete(key),
	})
	vi.stubGlobal("Worker", class {})
	vi.stubGlobal("navigator", { storage: { getDirectory: () => Promise.resolve({}) } })
	vi.stubGlobal("window", { location: { reload } })
})

afterEach(() => {
	vi.unstubAllGlobals()
})

describe("local cache", () => {
	it("is off unless the flag is on", async () => {
		const cache = await loadModule(undefined)
		expect(cache.localCachePersistence).toBeUndefined()
		cache.bindLocalCache(userA)
		expect(persistence.open).not.toHaveBeenCalled()
		expect(reload).not.toHaveBeenCalled()
	})

	it("is off where the browser has no OPFS", async () => {
		vi.stubGlobal("navigator", {})
		const cache = await loadModule("on")
		expect(cache.localCachePersistence).toBeUndefined()
	})

	it("opens the user's own file, and only once it is bound", async () => {
		const execute = vi.fn(async () => [{ ok: 1 }])
		persistence.open.mockResolvedValue({ execute })
		const cache = await loadModule("on")
		expect(cache.localCachePersistence).toBeDefined()
		const query = databaseOf().execute("SELECT 1")
		expect(persistence.open).not.toHaveBeenCalled()

		cache.bindLocalCache(userA)
		await expect(query).resolves.toEqual([{ ok: 1 }])
		expect(persistence.open).toHaveBeenCalledWith({ databaseName: `hazel-cache-${userA}.sqlite` })
		cache.bindLocalCache(userA)
		expect(persistence.open).toHaveBeenCalledTimes(1)
		expect(reload).not.toHaveBeenCalled()
	})

	it("reloads when another user signs in on the same page", async () => {
		persistence.open.mockResolvedValue({ execute: async () => [] })
		const cache = await loadModule("on")
		cache.bindLocalCache(userA)
		cache.bindLocalCache(userB)
		expect(reload).toHaveBeenCalledTimes(1)
		expect(persistence.open).toHaveBeenCalledTimes(1)
	})

	it("turns itself off and reloads when the file cannot open", async () => {
		persistence.open.mockRejectedValue(new Error("OPFS unavailable"))
		vi.spyOn(console, "error").mockImplementation(() => {})
		const cache = await loadModule("on")
		cache.bindLocalCache(userA)
		await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
		expect(storage.has("hazel:local-cache")).toBe(false)
	})
})
