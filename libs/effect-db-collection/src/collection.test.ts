import { createLiveQueryCollection, eq, inArray } from "@tanstack/db"
import { Effect, Exit, Schema } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"
import { channelPartition, createEffectCollection, sourceSet } from "./collection"
import { SyncHub, type SyncHubConfig } from "./hub"
import { extractPartitionValues } from "./subset"
import { fakeSockets } from "./testing/fake-websocket"

const User = Schema.Struct({ id: Schema.String, name: Schema.String })
const Channel = Schema.Struct({ id: Schema.String, name: Schema.String })
const Message = Schema.Struct({ id: Schema.String, channelId: Schema.String, content: Schema.String })

const hubs: Array<SyncHub> = []
let collectionCount = 0

const setup = (config: Partial<SyncHubConfig> = {}) => {
	const sockets = fakeSockets()
	const log = vi.fn()
	const hub = new SyncHub({
		baseUrl: "https://sync.test",
		getToken: async () => "token",
		WebSocket: sockets.WebSocket,
		backoff: { initialDelayMs: 5, maxDelayMs: 20, jitter: false },
		releaseGraceMs: 0,
		log,
		...config,
	})
	hubs.push(hub)
	return { sockets, hub, log }
}

/** Waits until a socket exists for `path` (the token read is async). */
const socketFor = async (sockets: ReturnType<typeof fakeSockets>, path: string, count = 1) => {
	await vi.waitFor(() => expect(sockets.count(path)).toBeGreaterThanOrEqual(count))
	return sockets.latest(path)!
}

const ids = (collection: { toArray: ReadonlyArray<{ id: string }> }) =>
	collection.toArray.map((row) => row.id).sort()

afterEach(() => {
	for (const hub of hubs.splice(0)) hub.close()
})

describe("sourced collections", () => {
	it("becomes ready after the source snapshot", async () => {
		const { sockets, hub } = setup()
		const channels = createEffectCollection({
			id: `channels-${++collectionCount}`,
			table: "channels",
			schema: Channel,
			getKey: (row) => row.id,
			hub,
			sources: ["org:a"],
		})
		const ready = channels.preload()
		const socket = await socketFor(sockets, "/sync/org/a")
		expect(channels.isReady()).toBe(false)
		socket.snapshot(1, {
			channels: [
				{ id: "c1", name: "general" },
				{ id: "c2", name: "random" },
			],
		})
		await ready
		expect(channels.isReady()).toBe(true)
		expect(channels.get("c1")).toMatchObject({ id: "c1", name: "general" })
		expect(ids(channels)).toEqual(["c1", "c2"])
	})

	it("applies catch-up runs after a reconnect without dropping rows", async () => {
		const { sockets, hub } = setup()
		const channels = createEffectCollection({
			id: `channels-${++collectionCount}`,
			table: "channels",
			schema: Channel,
			getKey: (row) => row.id,
			hub,
			sources: ["org:a"],
		})
		const ready = channels.preload()
		const first = await socketFor(sockets, "/sync/org/a")
		first.snapshot(4, { channels: [{ id: "c1", name: "general" }] })
		await ready
		first.serverClose(1006)

		const second = await socketFor(sockets, "/sync/org/a", 2)
		second.open()
		expect(second.sent[0]).toEqual({ _tag: "Hello", since: 4 })
		second.commit(6, {
			channels: {
				upserts: [
					{ id: "c2", name: "new" },
					{ id: "c1", name: "renamed" },
				],
			},
		})
		second.receive({ _tag: "Ready" })
		expect(channels.get("c1")?.name).toBe("renamed")
		expect(ids(channels)).toEqual(["c1", "c2"])
		second.commit(7, { channels: { deletes: ["c2"] } })
		expect(ids(channels)).toEqual(["c1"])
	})

	it("drops only the resetting source's rows, and keeps keys another source still holds", async () => {
		const { sockets, hub } = setup()
		const users = createEffectCollection({
			id: `users-${++collectionCount}`,
			table: "users",
			schema: User,
			getKey: (row) => row.id,
			hub,
			sources: ["org:a", "org:b"],
		})
		const ready = users.preload()
		const a = await socketFor(sockets, "/sync/org/a")
		const b = await socketFor(sockets, "/sync/org/b")
		a.snapshot(1, {
			users: [
				{ id: "u1", name: "only a" },
				{ id: "u3", name: "both" },
			],
		})
		expect(users.isReady()).toBe(false)
		b.snapshot(1, {
			users: [
				{ id: "u2", name: "only b" },
				{ id: "u3", name: "both" },
			],
		})
		await ready
		expect(ids(users)).toEqual(["u1", "u2", "u3"])

		// org:a resets with a snapshot that no longer has u1 or u3.
		a.commit(9, { users: { upserts: [{ id: "u4", name: "new in a" }] } }, true)
		expect(ids(users)).toEqual(["u2", "u3", "u4"])

		// A delete from one source keeps a key the other still holds.
		a.commit(10, { users: { upserts: [{ id: "u2", name: "only b" }] } })
		a.commit(11, { users: { deletes: ["u2"] } })
		expect(ids(users)).toEqual(["u2", "u3", "u4"])
		b.commit(2, { users: { deletes: ["u2", "u3"] } })
		expect(ids(users)).toEqual(["u4"])
	})

	it("follows a source set: waits while unknown, opens added sources, drops removed ones", async () => {
		const { sockets, hub } = setup()
		const orgs = sourceSet()
		const users = createEffectCollection({
			id: `users-${++collectionCount}`,
			table: "users",
			schema: User,
			getKey: (row) => row.id,
			hub,
			sources: orgs,
		})
		const ready = users.preload()
		await Promise.resolve()
		expect(users.isReady()).toBe(false)
		expect(sockets.all).toHaveLength(0)

		orgs.set(["org:a", "org:b"])
		const a = await socketFor(sockets, "/sync/org/a")
		const b = await socketFor(sockets, "/sync/org/b")
		a.snapshot(1, { users: [{ id: "u1", name: "a" }] })
		b.snapshot(1, { users: [{ id: "u2", name: "b" }] })
		await ready
		expect(ids(users)).toEqual(["u1", "u2"])

		orgs.set(["org:a"])
		expect(b.isClosed).toBe(true)
		expect(ids(users)).toEqual(["u1"])
	})

	it("treats an empty source set as ready", async () => {
		const { hub } = setup()
		const users = createEffectCollection({
			id: `users-${++collectionCount}`,
			table: "users",
			schema: User,
			getKey: (row) => row.id,
			hub,
			sources: [],
		})
		await users.preload()
		expect(users.isReady()).toBe(true)
	})

	it("becomes ready when a source is refused, and drops its rows", async () => {
		const { sockets, hub } = setup()
		const users = createEffectCollection({
			id: `users-${++collectionCount}`,
			table: "users",
			schema: User,
			getKey: (row) => row.id,
			hub,
			sources: ["org:a", "org:gone"],
		})
		const ready = users.preload()
		;(await socketFor(sockets, "/sync/org/a")).snapshot(1, { users: [{ id: "u1", name: "a" }] })
		;(await socketFor(sockets, "/sync/org/gone")).serverClose(4004)
		await ready
		expect(hub.statusOf("org:gone")).toMatchObject({ state: "error", terminal: true })
		expect(ids(users)).toEqual(["u1"])
	})

	it("skips rows its schema cannot decode", async () => {
		const { sockets, hub, log } = setup()
		const users = createEffectCollection({
			id: `users-${++collectionCount}`,
			table: "users",
			schema: User,
			getKey: (row) => row.id,
			hub,
			sources: ["org:a"],
		})
		const ready = users.preload()
		;(await socketFor(sockets, "/sync/org/a")).snapshot(1, {
			users: [
				{ id: "u1", name: "ok" },
				{ id: "u2", name: 42 },
			],
		})
		await ready
		expect(ids(users)).toEqual(["u1"])
		expect(log).toHaveBeenCalledWith(
			"warning",
			"Skipping a synced row the schema cannot decode",
			expect.objectContaining({ table: "users", source: "org:a" }),
		)
	})

	it("routes one source's runs to every table's collection", async () => {
		const { sockets, hub } = setup()
		const channels = createEffectCollection({
			id: `channels-${++collectionCount}`,
			table: "channels",
			schema: Channel,
			getKey: (row) => row.id,
			hub,
			sources: ["org:a"],
		})
		const users = createEffectCollection({
			id: `users-${++collectionCount}`,
			table: "users",
			schema: User,
			getKey: (row) => row.id,
			hub,
			sources: ["org:a"],
		})
		const ready = Promise.all([channels.preload(), users.preload()])
		const socket = await socketFor(sockets, "/sync/org/a")
		socket.snapshot(1, { channels: [{ id: "c1", name: "general" }], users: [{ id: "u1", name: "x" }] })
		await ready
		expect(sockets.count("/sync/org/a")).toBe(1)
		expect(ids(channels)).toEqual(["c1"])
		expect(ids(users)).toEqual(["u1"])
	})
})

describe("late collections", () => {
	it("resyncs a source that already delivered the new collection's table", async () => {
		const { sockets, hub } = setup()
		const channels = createEffectCollection({
			id: `channels-${++collectionCount}`,
			table: "channels",
			schema: Channel,
			getKey: (row) => row.id,
			hub,
			sources: ["org:a"],
		})
		const ready = channels.preload()
		const first = await socketFor(sockets, "/sync/org/a")
		first.snapshot(5, { channels: [{ id: "c1", name: "general" }], users: [{ id: "u1", name: "x" }] })
		await ready

		const users = createEffectCollection({
			id: `users-${++collectionCount}`,
			table: "users",
			schema: User,
			getKey: (row) => row.id,
			hub,
			sources: ["org:a"],
		})
		const second = await socketFor(sockets, "/sync/org/a", 2)
		expect(first.isClosed).toBe(true)
		second.open()
		expect(second.sent[0]).toEqual({ _tag: "Hello", since: null })
		second.snapshot(5, { channels: [{ id: "c1", name: "general" }], users: [{ id: "u1", name: "x" }] })
		await users.preload()
		expect(ids(users)).toEqual(["u1"])
		expect(ids(channels)).toEqual(["c1"])
	})
})

describe("channel-partitioned collections", () => {
	const messagesSetup = (config: Partial<SyncHubConfig> = {}) => {
		const env = setup(config)
		const messages = createEffectCollection({
			id: `messages-${++collectionCount}`,
			table: "messages",
			schema: Message,
			getKey: (row) => row.id,
			hub: env.hub,
			sources: channelPartition(),
		})
		return { ...env, messages }
	}

	it("opens channel:<id> for a query's channel and closes it when the query goes away", async () => {
		const { sockets, messages } = messagesSetup()
		const live = createLiveQueryCollection((q) =>
			q.from({ m: messages }).where(({ m }) => eq(m.channelId, "c1")),
		)
		const ready = live.preload()
		const socket = await socketFor(sockets, "/sync/channel/c1")
		socket.snapshot(3, {
			messages: [
				{ id: "m1", channelId: "c1", content: "hi" },
				{ id: "m2", channelId: "c1", content: "there" },
			],
		})
		await ready
		expect(ids(live)).toEqual(["m1", "m2"])
		expect(sockets.all).toHaveLength(1)

		await live.cleanup()
		await vi.waitFor(() => expect(socket.isClosed).toBe(true))
		expect(messages.toArray).toHaveLength(0)
	})

	it("opens every channel of an inArray predicate", async () => {
		const { sockets, messages } = messagesSetup()
		const live = createLiveQueryCollection((q) =>
			q.from({ m: messages }).where(({ m }) => inArray(m.channelId, ["c1", "c2"])),
		)
		const ready = live.preload()
		;(await socketFor(sockets, "/sync/channel/c1")).snapshot(1, {
			messages: [{ id: "m1", channelId: "c1", content: "a" }],
		})
		;(await socketFor(sockets, "/sync/channel/c2")).snapshot(1, {
			messages: [{ id: "m2", channelId: "c2", content: "b" }],
		})
		await ready
		expect(ids(live)).toEqual(["m1", "m2"])
		await live.cleanup()
	})

	it("keeps a released channel open for the grace period", async () => {
		const { sockets, messages } = messagesSetup({ releaseGraceMs: 60 })
		const query = () =>
			createLiveQueryCollection((q) => q.from({ m: messages }).where(({ m }) => eq(m.channelId, "c1")))
		const first = query()
		const ready = first.preload()
		const socket = await socketFor(sockets, "/sync/channel/c1")
		socket.snapshot(1, { messages: [{ id: "m1", channelId: "c1", content: "a" }] })
		await ready
		await first.cleanup()

		// Back within the grace period: same socket, no new snapshot needed.
		const second = query()
		await second.preload()
		expect(ids(second)).toEqual(["m1"])
		expect(sockets.count("/sync/channel/c1")).toBe(1)
		await second.cleanup()
		await vi.waitFor(() => expect(socket.isClosed).toBe(true))
	})

	it("loads channels named through ensureChannels for the scope", async () => {
		const { sockets, messages } = messagesSetup()
		const live = createLiveQueryCollection((q) => q.from({ m: messages }))
		await live.preload()
		// No channel in the predicate: nothing loads.
		expect(sockets.all).toHaveLength(0)

		const loaded = Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					yield* messages.utils.ensureChannels(["c9"])
					return ids(live)
				}),
			),
		)
		;(await socketFor(sockets, "/sync/channel/c9")).snapshot(1, {
			messages: [{ id: "m9", channelId: "c9", content: "x" }],
		})
		expect(await loaded).toEqual(["m9"])
		expect(sockets.latest("/sync/channel/c9")!.isClosed).toBe(true)
		await live.cleanup()
	})

	it("ensureChannels fails with the refusal", async () => {
		const { sockets, messages } = messagesSetup()
		const exit = Effect.runPromiseExit(Effect.scoped(messages.utils.ensureChannels(["secret"])))
		;(await socketFor(sockets, "/sync/channel/secret")).serverClose(4003)
		const result = await exit
		expect(Exit.isFailure(result)).toBe(true)
		if (Exit.isFailure(result)) expect(String(result.cause)).toContain("SyncSourceForbiddenError")
	})
})

describe("awaitSeqEffect", () => {
	it("resolves once the source commits the seq, opening it transiently", async () => {
		const { sockets, hub } = setup()
		const channels = createEffectCollection({
			id: `channels-${++collectionCount}`,
			table: "channels",
			schema: Channel,
			getKey: (row) => row.id,
			hub,
			sources: ["org:a"],
		})
		const waiting = Effect.runPromise(channels.utils.awaitSeqEffect("org:b:5", 5000))
		const socket = await socketFor(sockets, "/sync/org/b")
		socket.snapshot(5, {})
		expect(await waiting).toBe(true)
		expect(socket.isClosed).toBe(true)
	})

	it("fails with TxIdTimeoutError and InvalidTxIdError", async () => {
		const { sockets, hub } = setup()
		const channels = createEffectCollection({
			id: `channels-${++collectionCount}`,
			table: "channels",
			schema: Channel,
			getKey: (row) => row.id,
			hub,
			sources: ["org:a"],
		})
		const timeout = Effect.runPromise(Effect.flip(channels.utils.awaitSeqEffect("org:a:5", 30)))
		;(await socketFor(sockets, "/sync/org/a")).snapshot(4, {})
		expect(await timeout).toMatchObject({ _tag: "TxIdTimeoutError", txid: "org:a:5", timeout: 30 })

		const invalid = await Effect.runPromise(Effect.flip(channels.utils.awaitSeqEffect("42")))
		expect(invalid._tag).toBe("InvalidTxIdError")
	})

	it("resolves a local position at once: no source streams it", async () => {
		const { sockets, hub } = setup()
		const channels = createEffectCollection({
			id: `channels-${++collectionCount}`,
			table: "channels",
			schema: Channel,
			getKey: (row) => row.id,
			hub,
			sources: ["org:a"],
		})
		expect(await Effect.runPromise(channels.utils.awaitSeqEffect("local:0"))).toBe(true)
		expect(sockets.all).toHaveLength(0)
	})
})

describe("extractPartitionValues", () => {
	it("reads eq, inArray, and, or", () => {
		const val = (value: unknown) => ({ type: "val", value })
		const func = (name: string, args: Array<unknown>) => ({ type: "func", name, args })
		const ch = { type: "ref", path: ["m", "channelId"] }
		const id = { type: "ref", path: ["id"] }
		expect(extractPartitionValues(func("eq", [ch, val("c1")]) as never, "channelId")).toEqual(["c1"])
		expect(extractPartitionValues(func("in", [ch, val(["c1", "c2"])]) as never, "channelId")).toEqual([
			"c1",
			"c2",
		])
		expect(
			extractPartitionValues(
				func("and", [func("gt", [id, val("x")]), func("eq", [val("c3"), ch])]) as never,
				"channelId",
			),
		).toEqual(["c3"])
		expect(
			extractPartitionValues(
				func("or", [func("eq", [ch, val("c1")]), func("eq", [id, val("m")])]) as never,
				"channelId",
			),
		).toBeUndefined()
		expect(extractPartitionValues(func("eq", [id, val("m")]) as never, "channelId")).toBeUndefined()
		expect(extractPartitionValues(undefined, "channelId")).toBeUndefined()
	})
})
