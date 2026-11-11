/**
 * Cold start with and without the persisted cache, on a synthetic org. Run with
 * `BENCH=1 bunx vitest run src/cold-start.bench.test.ts`.
 *
 * The sockets are fakes: frames arrive at once, so the times are the client's own work (decode,
 * mirror, TanStack, SQLite), not the network or the Durable Object's snapshot. The bytes are the
 * JSON the socket would carry. `node:sqlite` stands in for wa-sqlite on OPFS, which is slower.
 */
import { mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import {
	type BrowserWASQLiteDatabase,
	createBrowserWASQLitePersistence,
	persistedCollectionOptions,
} from "@tanstack/browser-db-sqlite-persistence"
import { Schema } from "effect"
import { describe, expect, it, vi } from "vitest"
import { createEffectCollection, type EffectCollection, sourceSet } from "./collection"
import { SyncHub } from "./hub"
import { type FakeSocket, fakeSockets } from "./testing/fake-websocket"

const Row = Schema.Struct({
	id: Schema.String,
	organizationId: Schema.String,
	name: Schema.String,
	description: Schema.NullOr(Schema.String),
	avatarUrl: Schema.NullOr(Schema.String),
	kind: Schema.String,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	deletedAt: Schema.NullOr(Schema.String),
})
type Row = typeof Row.Type

interface OrgSize {
	readonly label: string
	readonly users: number
	readonly channels: number
	readonly channelMembers: number
}

const SIZES: ReadonlyArray<OrgSize> = [
	{ label: "small (50 users, 20 channels)", users: 50, channels: 20, channelMembers: 400 },
	{ label: "medium (500 users, 200 channels)", users: 500, channels: 200, channelMembers: 5_000 },
	{ label: "large (5k users, 1k channels)", users: 5_000, channels: 1_000, channelMembers: 50_000 },
]

/** The org object's eager tables (one collection each), with their row counts. */
const tablesOf = (size: OrgSize): Record<string, number> => ({
	organizations: 1,
	users: size.users,
	organization_members: size.users,
	user_presence_status: size.users,
	channels: size.channels,
	channel_members: size.channelMembers,
	channel_sections: 10,
	bots: 5,
	custom_emojis: 50,
})

const at = "2026-10-01T12:00:00.000Z"
const row = (table: string, i: number, name = `${table} ${i}`): Row => ({
	id: `${table}-${i}`,
	organizationId: "org-a",
	name,
	description: i % 3 === 0 ? `A description for ${table} number ${i}, roughly a sentence long.` : null,
	avatarUrl: i % 2 === 0 ? `https://cdn.hazel.test/avatars/${table}/${i}.png` : null,
	kind: i % 5 === 0 ? "private" : "public",
	createdAt: at,
	updatedAt: at,
	deletedAt: null,
})

const snapshotOf = (size: OrgSize) =>
	Object.fromEntries(
		Object.entries(tablesOf(size)).map(([table, count]) => [
			table,
			Array.from({ length: count }, (_, i) => row(table, i)),
		]),
	)

/** The JSON a run's frames carry. */
const runBytes = (
	tables: Record<string, { upserts: ReadonlyArray<unknown>; deletes: ReadonlyArray<string> }>,
	reset: boolean,
) => {
	let bytes =
		JSON.stringify({ _tag: "Begin", reset }).length + JSON.stringify({ _tag: "Commit", seq: 1 }).length
	for (const [table, rows] of Object.entries(tables)) {
		bytes += JSON.stringify({ _tag: "Rows", table, ...rows }).length
	}
	return bytes
}

const nodeDatabase = (path: string): BrowserWASQLiteDatabase & { readonly close: () => void } => {
	const db = new DatabaseSync(path)
	return {
		execute: async <TRow>(sql: string, params: ReadonlyArray<unknown> = []) => {
			if (params.length === 0 && sql.trim().replace(/;$/, "").includes(";")) {
				db.exec(sql)
				return []
			}
			const statement = db.prepare(sql)
			const args = params as Array<SQLInputValue>
			if (statement.columns().length > 0) return statement.all(...args) as Array<TRow>
			statement.run(...args)
			return []
		},
		close: () => db.close(),
	}
}

/** One page load: a hub and a collection per table, persisted on `path` when given. */
const load = (size: OrgSize, path: string | undefined) => {
	const sockets = fakeSockets()
	const hub = new SyncHub({
		baseUrl: "https://sync.test",
		getToken: async () => "token",
		WebSocket: sockets.WebSocket,
		releaseGraceMs: 0,
		log: () => {},
	})
	const database = path === undefined ? undefined : nodeDatabase(path)
	const persistence = database === undefined ? undefined : createBrowserWASQLitePersistence({ database })
	const sources = sourceSet(["org:a"])
	const collections: Array<EffectCollection<Row>> = Object.keys(tablesOf(size)).map((table) =>
		createEffectCollection<Row, string | number>(
			{ id: table, table, schema: Row, getKey: (r) => r.id, hub, sources },
			persistence === undefined
				? undefined
				: (options) => persistedCollectionOptions({ ...options, persistence, schemaVersion: 1 }),
		),
	)
	const ready = () => Promise.all(collections.map((collection) => collection.preload()))
	const socket = async (): Promise<FakeSocket> => {
		await vi.waitFor(() => expect(sockets.count("/sync/org/a")).toBe(1), { timeout: 10_000, interval: 1 })
		return sockets.latest("/sync/org/a")!
	}
	const rowCount = () => collections.reduce((sum, collection) => sum + collection.size, 0)
	const users = collections[Object.keys(tablesOf(size)).indexOf("users")]!
	const unload = async () => {
		for (const collection of collections) await collection.cleanup()
		database?.close()
		hub.close()
	}
	return { ready, socket, rowCount, users, unload }
}

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const median = (values: ReadonlyArray<number>) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!
const ms = (value: number) => `${value.toFixed(1)} ms`
const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`

const RUNS = Number(process.env.BENCH_RUNS ?? 5)
const CATCH_UP_CHANGES = 20

describe.skipIf(!process.env.BENCH)("cold start", () => {
	it("compares a snapshot with a restore and resume", { timeout: 600_000 }, async () => {
		const results: Array<Record<string, string>> = []
		for (const size of SIZES) {
			const snapshot = snapshotOf(size)
			const total = Object.values(snapshot).reduce((sum, rows) => sum + rows.length, 0)
			const snapshotBytes = runBytes(
				Object.fromEntries(
					Object.entries(snapshot).map(([t, upserts]) => [t, { upserts, deletes: [] }]),
				),
				true,
			)
			const catchUp = {
				users: {
					upserts: Array.from({ length: CATCH_UP_CHANGES }, (_, i) =>
						row("users", i, `renamed ${i}`),
					),
					deletes: [],
				},
			}
			const catchUpBytes = runBytes(catchUp, false)

			const cold: Array<number> = []
			const firstPersisted: Array<number> = []
			const warmRows: Array<number> = []
			const warmCaughtUp: Array<number> = []
			let fileBytes = 0
			let since: unknown

			for (let run = 0; run < RUNS; run++) {
				// 1. No cache: every row comes in the snapshot.
				{
					const start = performance.now()
					const page = load(size, undefined)
					const ready = page.ready()
					;(await page.socket()).snapshot(10, snapshot)
					await ready
					cold.push(performance.now() - start)
					expect(page.rowCount()).toBe(total)
					await page.unload()
				}

				// 2. First load with the cache: the snapshot, also written to disk.
				const dir = mkdtempSync(join(tmpdir(), "hazel-bench-"))
				const path = join(dir, "cache.sqlite")
				try {
					{
						const start = performance.now()
						const page = load(size, path)
						const ready = page.ready()
						;(await page.socket()).snapshot(10, snapshot)
						await ready
						firstPersisted.push(performance.now() - start)
						// The rows' and then the seqs' writes land on disk.
						await settle(1_500)
						await page.unload()
						fileBytes =
							statSync(path).size +
							(statSync(`${path}-wal`, { throwIfNoEntry: false })?.size ?? 0)
					}

					// 3. Warm: rows from disk, then the source resumes with the changes since.
					{
						const start = performance.now()
						const page = load(size, path)
						await page.ready()
						warmRows.push(performance.now() - start)
						expect(page.rowCount()).toBe(total)
						const socket = await page.socket()
						socket.open()
						since = socket.sent.find((frame) => frame._tag === "Hello")?.since
						socket.commit(11, catchUp)
						socket.receive({ _tag: "Ready" })
						await vi.waitFor(() => expect(page.users.get("users-0")?.name).toBe("renamed 0"), {
							interval: 1,
						})
						warmCaughtUp.push(performance.now() - start)
						await page.unload()
					}
				} finally {
					rmSync(dir, { recursive: true, force: true })
				}
			}

			expect(since).toBe(10)
			results.push({
				org: size.label,
				rows: String(total),
				"cold: rows on screen": ms(median(cold)),
				"cold: wire": kb(snapshotBytes),
				"first cached load": ms(median(firstPersisted)),
				"warm: rows on screen": ms(median(warmRows)),
				"warm: caught up": ms(median(warmCaughtUp)),
				"warm: wire": kb(catchUpBytes),
				"cache on disk": kb(fileBytes),
			})
		}
		process.stdout.write(`\n${JSON.stringify(results, null, 1)}\n`)
	})
})
