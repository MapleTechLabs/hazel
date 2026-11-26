/**
 * The package loads and runs with no browser: browser globals are removed before it is imported,
 * the client is built from fake platform services, and a live query follows a fake sync socket.
 */
import { encodeMuxData, type SyncServerFrame } from "@hazel/domain/sync"
import { fakeSockets } from "@hazel/effect-db-collection/testing"
import { Effect, Fiber, Layer, Stream } from "effect"
import { afterAll, expect, test, vi } from "vitest"

const BROWSER_GLOBALS = [
	"window",
	"document",
	"navigator",
	"location",
	"localStorage",
	"sessionStorage",
	"indexedDB",
	"WebSocket",
	"fetch",
	"Request",
	"Response",
	"Headers",
	"crypto",
	"Worker",
	"addEventListener",
	"removeEventListener",
	"dispatchEvent",
	"CustomEvent",
	"requestAnimationFrame",
] as const

for (const name of BROWSER_GLOBALS) vi.stubGlobal(name, undefined)
afterAll(() => vi.unstubAllGlobals())

const organizationId = "00000000-0000-4000-8000-0000000000aa"
const channelRow = (name: string) => ({
	id: "00000000-0000-4000-8000-0000000000c1",
	name,
	icon: null,
	type: "public",
	organizationId,
	parentChannelId: null,
	sectionId: null,
	lastMessageAt: null,
	lastMessageAuthorId: null,
	lastMessagePreview: null,
	createdAt: "2026-11-01T10:00:00.000Z",
	updatedAt: null,
	deletedAt: null,
})

test("builds the client and runs a live query with no browser globals", async () => {
	for (const name of BROWSER_GLOBALS)
		expect(Reflect.getOwnPropertyDescriptor(globalThis, name)?.value).toBeUndefined()
	const Data = await import("./index")

	const sockets = fakeSockets()
	const store = new Map<string, string>()
	let nextId = 0
	const platform = Layer.mergeAll(
		Layer.succeed(Data.ClientDataConfig, { apiUrl: "https://api.test", isRetryableError: () => false }),
		Layer.succeed(Data.Ids, {
			randomUUID: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}`,
		}),
		Layer.succeed(Data.KeyValue, {
			get: (key) => store.get(key) ?? null,
			set: (key, value) => void store.set(key, value),
			remove: (key) => void store.delete(key),
		}),
		Layer.succeed(Data.Sockets, { WebSocket: sockets.WebSocket }),
		Layer.succeed(Data.Connectivity, { subscribeOnline: () => () => {} }),
		Layer.succeed(Data.Session, {
			getAccessToken: async () => "token",
			invalidateAccessToken: () => {},
			authorization: Effect.succeed(null),
		}),
		Layer.succeed(Data.LocalCache, {
			persist: undefined,
			snapshots: undefined,
			bind: () => {},
			forget: async () => false,
		}),
	)

	const client = await Effect.runPromise(Data.ClientData.make.pipe(Effect.provide(platform)))
	client.orgSources.set([`org:${organizationId}`])

	const names = client
		.liveQueryStream(
			(q) => q.from({ channel: client.collections.channelCollection }),
			(rows: ReadonlyArray<{ readonly name: string; readonly createdAt: Date }>) =>
				rows.map((row) => `${row.name}@${row.createdAt.toISOString()}`),
		)
		.pipe(
			Stream.filter((rows) => rows.length > 0),
			// The first result can be sent twice (first ready, then the change that made it).
			Stream.changesWith((a, b) => a.join() === b.join()),
			Stream.take(2),
			Stream.runCollect,
		)
	const fiber = Effect.runFork(names)

	const socket = await vi.waitFor(() => {
		const found = sockets.latest("/sync/mux")
		if (found === undefined) throw new Error("no socket yet")
		return found
	})
	expect(socket.url).toBe("wss://api.test/sync/mux")
	socket.open()
	const open = socket.sent.find((frame) => frame._tag === "Open")
	expect(open).toMatchObject({ kind: "org", sourceId: organizationId })
	const id = open!.id as number
	const send = (frame: SyncServerFrame | Record<string, unknown>) =>
		socket.receiveRaw(encodeMuxData(id, JSON.stringify(frame)))
	socket.receive({ _tag: "Opened", id, hello: true })
	send({ _tag: "Begin", reset: true })
	send({ _tag: "Rows", table: "channels", upserts: [channelRow("general")], deletes: [] })
	send({ _tag: "Commit", seq: 1 })
	send({ _tag: "Ready" })
	// A live update after the snapshot.
	await vi.waitFor(() => expect(client.collections.channelCollection.size).toBe(1))
	send({ _tag: "Begin", reset: false })
	send({ _tag: "Rows", table: "channels", upserts: [channelRow("announcements")], deletes: [] })
	send({ _tag: "Commit", seq: 2 })

	const emitted = await Effect.runPromise(Fiber.join(fiber))
	expect(Array.from(emitted)).toEqual([
		["general@2026-11-01T10:00:00.000Z"],
		["announcements@2026-11-01T10:00:00.000Z"],
	])
	client.closeSync()
})
