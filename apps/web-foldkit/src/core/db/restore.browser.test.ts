/**
 * The local cache in Chromium, on what the app runs on: wa-sqlite on OPFS behind its worker. A
 * load fills as many eager collections as the app has, the next one restores them from the file,
 * and the test reports how long the rows took to show (node SQLite, which the other benches use,
 * has no worker between the collections and the database).
 */
import {
	createBrowserWASQLitePersistence,
	openBrowserWASQLiteOPFSDatabase,
	persistedCollectionOptions,
} from "@tanstack/browser-db-sqlite-persistence"
import {
	createEffectCollection,
	type EffectCollection,
	SyncHub,
	sourceSet,
} from "@hazel/effect-db-collection"
import { fakeSockets } from "@hazel/effect-db-collection/testing"
import { Schema } from "effect"
import { afterEach, describe, expect, test, vi } from "vitest"

const Row = Schema.Struct({
	id: Schema.String,
	organizationId: Schema.String,
	name: Schema.String,
	description: Schema.NullOr(Schema.String),
	avatarUrl: Schema.NullOr(Schema.String),
	createdAt: Schema.String,
	updatedAt: Schema.String,
	deletedAt: Schema.NullOr(Schema.String),
})
type Row = typeof Row.Type

/** The org shell's tables first, as `collections.ts` creates them; the rest hold little or nothing. */
const TABLES = {
	organizations: 1,
	users: 500,
	organization_members: 500,
	channels: 200,
	channel_members: 5_000,
	channel_sections: 10,
	user_presence_status: 500,
	bots: 5,
	custom_emojis: 50,
	...Object.fromEntries(Array.from({ length: 18 }, (_, i) => [`small_${i}`, i % 3 === 0 ? 0 : 3])),
}

const at = "2026-10-01T12:00:00.000Z"
const snapshot = Object.fromEntries(
	Object.entries(TABLES).map(([table, count]) => [
		table,
		Array.from({ length: count }, (_, i): Row => ({
			id: `${table}-${i}`,
			organizationId: "org-a",
			name: `${table} ${i}`,
			description: i % 3 === 0 ? `A description for ${table} number ${i}.` : null,
			avatarUrl: i % 2 === 0 ? `https://cdn.hazel.test/avatars/${table}/${i}.png` : null,
			createdAt: at,
			updatedAt: at,
			deletedAt: null,
		})),
	]),
)
const totalRows = Object.values(TABLES).reduce((sum, count) => sum + count, 0)

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/** One page load on the file `databaseName`: a hub, the database, and a collection per table. */
const load = async (databaseName: string) => {
	const startedAt = performance.now()
	const sockets = fakeSockets()
	const hub = new SyncHub({
		baseUrl: "https://sync.test",
		getToken: async () => "token",
		WebSocket: sockets.WebSocket,
		releaseGraceMs: 0,
		log: () => {},
	})
	const opening = openBrowserWASQLiteOPFSDatabase({ databaseName })
	const persistence = createBrowserWASQLitePersistence({
		database: { execute: (sql, params) => opening.then((db) => db.execute(sql, params)) },
	})
	const sources = sourceSet(["org:a"])
	const readyAt = new Map<string, number>()
	const collections = new Map<string, EffectCollection<Row>>(
		Object.keys(TABLES).map((table) => {
			const collection = createEffectCollection<Row, string | number>(
				{ id: table, table, schema: Row, getKey: (row) => row.id, hub, sources },
				(options) => persistedCollectionOptions({ ...options, persistence, schemaVersion: 1 }),
			)
			collection.onFirstReady(() => readyAt.set(table, performance.now() - startedAt))
			return [table, collection]
		}),
	)
	const database = await opening
	const openedAt = performance.now() - startedAt
	const unload = async () => {
		for (const collection of collections.values()) await collection.cleanup()
		await database.close?.()
		hub.close()
	}
	cleanups.push(unload)
	const allReady = () => Promise.all([...collections.values()].map((collection) => collection.preload()))
	const socket = async () => {
		await vi.waitFor(() => expect(sockets.count("/sync/org/a")).toBe(1), { timeout: 30_000 })
		return sockets.latest("/sync/org/a")!
	}
	const rowCount = () => [...collections.values()].reduce((sum, collection) => sum + collection.size, 0)
	return { collections, readyAt, openedAt, allReady, socket, rowCount, unload, startedAt }
}

describe("local cache on OPFS", () => {
	test(
		"restores every collection from the file before any source answers",
		{ timeout: 120_000 },
		async () => {
			// As long as a user's file (`local-cache.ts`): wa-sqlite opens no longer name.
			const databaseName = `hazel-cache-${crypto.randomUUID()}.sqlite`
			cleanups.push(async () => {
				const root = await navigator.storage.getDirectory()
				await root.removeEntry(databaseName).catch(() => {})
			})

			const first = await load(databaseName)
			const ready = first.allReady()
			;(await first.socket()).snapshot(10, snapshot)
			await ready
			expect(first.rowCount()).toBe(totalRows)
			// The rows' and then the seqs' writes land on disk.
			await new Promise((resolve) => setTimeout(resolve, 2_500))
			cleanups.splice(cleanups.indexOf(first.unload), 1)
			await first.unload()

			const second = await load(databaseName)
			await second.allReady()
			const allAt = performance.now() - second.startedAt
			// No source has answered: every row, and the empty tables' readiness, came from the file.
			expect(second.rowCount()).toBe(totalRows)
			expect(second.collections.get("small_0")?.status).toBe("ready")
			expect(second.collections.get("channels")?.get("channels-7")?.name).toBe("channels 7")

			const at = (table: string) => `${Math.round(second.readyAt.get(table) ?? Number.NaN)} ms`
			console.log(
				`[restore] ${Object.keys(TABLES).length} collections, ${totalRows} rows: database open ${Math.round(second.openedAt)} ms, ` +
					`organizations ${at("organizations")}, channels ${at("channels")}, channel_members ${at("channel_members")}, ` +
					`all ${Math.round(allAt)} ms`,
			)

			// The sources resume after the stored seq instead of asking for a snapshot.
			const socket = await second.socket()
			socket.open()
			expect(socket.sent.find((frame) => frame._tag === "Hello")).toMatchObject({ since: 10 })
		},
	)
})
