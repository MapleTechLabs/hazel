import { Effect, Schema } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createEffectCollection } from "./collection"
import { SyncHub } from "./hub"
import { optimisticAction } from "./optimistic-action"
import { fakeSockets } from "./testing/fake-websocket"

const Channel = Schema.Struct({ id: Schema.String, name: Schema.String })

class CreateFailed extends Schema.TaggedError<CreateFailed>()("CreateFailed", {}) {}

const hubs: Array<SyncHub> = []
let count = 0

afterEach(() => {
	for (const hub of hubs.splice(0)) hub.close()
})

const setup = async () => {
	const sockets = fakeSockets()
	const hub = new SyncHub({
		baseUrl: "https://sync.test",
		getToken: async () => "token",
		WebSocket: sockets.WebSocket,
		releaseGraceMs: 0,
		log: () => {},
	})
	hubs.push(hub)
	const channels = createEffectCollection({
		id: `channels-${++count}`,
		table: "channels",
		schema: Channel,
		getKey: (row) => row.id,
		hub,
		sources: ["org:a"],
	})
	const ready = channels.preload()
	await vi.waitFor(() => expect(sockets.latest("/sync/org/a")).toBeDefined())
	const socket = sockets.latest("/sync/org/a")!
	socket.snapshot(1, { channels: [] })
	await ready
	return { channels, socket }
}

describe("optimisticAction", () => {
	it("applies at once, then keeps the synced row once the source passes the txid", async () => {
		const { channels, socket } = await setup()
		const create = optimisticAction({
			collections: [channels],
			onMutate: (name: string) => {
				channels.insert({ id: "c1", name })
				return { id: "c1" }
			},
			mutate: () =>
				Effect.sync(() => {
					// The server commits the write and its stream follows.
					setTimeout(
						() => socket.commit(2, { channels: { upserts: [{ id: "c1", name: "general" }] } }),
						5,
					)
					return { data: "ok", transactionId: "org:a:2" }
				}),
		})
		const running = Effect.runPromise(create("general"))
		expect(channels.get("c1")).toMatchObject({ name: "general" })
		const result = await running
		expect(result).toMatchObject({ data: "ok", transactionId: "org:a:2", mutateResult: { id: "c1" } })
		expect(channels.get("c1")).toMatchObject({ name: "general", $synced: true })
	})

	it("rolls back and keeps the typed failure when mutate fails", async () => {
		const { channels } = await setup()
		const create = optimisticAction({
			collections: [channels],
			onMutate: () => {
				channels.insert({ id: "c1", name: "x" })
				return {}
			},
			mutate: () => Effect.fail(new CreateFailed()),
		})
		const error = await Effect.runPromise(Effect.flip(create(undefined)))
		expect(error._tag).toBe("CreateFailed")
		expect(channels.has("c1")).toBe(false)
	})

	it("rolls back with SyncError when the source never passes the txid", async () => {
		const { channels } = await setup()
		const create = optimisticAction({
			collections: { channels },
			onMutate: () => {
				channels.insert({ id: "c1", name: "x" })
				return {}
			},
			mutate: () => Effect.succeed({ data: null, transactionId: "org:a:99" }),
			syncTimeout: 30,
		})
		const error = await Effect.runPromise(Effect.flip(create(undefined)))
		expect(error).toMatchObject({ _tag: "SyncError", txid: "org:a:99", collectionName: "channels" })
		expect((error as { cause?: { _tag?: string } }).cause?._tag).toBe("TxIdTimeoutError")
		expect(channels.has("c1")).toBe(false)
	})
})
