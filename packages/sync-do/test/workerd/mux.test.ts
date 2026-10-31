import { env, runInDurableObject, SELF } from "cloudflare:test"
import { decodeMuxData, encodeMuxData, type SyncMuxClientControl } from "@hazel/domain/sync"
import { describe, expect, it } from "vitest"
import type { Env, ToyObject } from "./worker.ts"

const testEnv = env as unknown as Env

type Frame = { readonly _tag: string } & Record<string, unknown>

/** A frame off the shared socket: a control frame (`id` undefined) or a stream's. */
interface Received {
	readonly id: number | undefined
	readonly frame: Frame
}

const write = async (name: string, id: string) =>
	(
		(await (
			await testEnv.TOY.get(testEnv.TOY.idFromName(name)).fetch(`http://toy/write?id=${id}`)
		).json()) as {
			seq: number
		}
	).seq

const socketsOf = (name: string) =>
	runInDurableObject(
		testEnv.TOY.get(testEnv.TOY.idFromName(name)),
		(_: ToyObject, state) => state.getWebSockets().length,
	)

/** Opens the shared socket through the test Worker's relay and collects what it carries. */
const connectMux = async () => {
	const response = await SELF.fetch("http://worker/mux", { headers: { Upgrade: "websocket" } })
	expect(response.status).toBe(101)
	const socket = response.webSocket!
	socket.accept()
	const received: Array<Received> = []
	const waiters: Array<() => void> = []
	socket.addEventListener("message", (event) => {
		const data = event.data as string
		const routed = decodeMuxData(data)
		received.push(
			routed === undefined
				? { id: undefined, frame: JSON.parse(data) }
				: { id: routed.id, frame: JSON.parse(routed.frame) },
		)
		for (const wake of waiters.splice(0)) wake()
	})
	const waitFor = async (predicate: (received: Received) => boolean) => {
		const deadline = Date.now() + 5_000
		while (true) {
			const found = received.find(predicate)
			if (found !== undefined) return found
			if (Date.now() > deadline) throw new Error(`Timed out; got ${JSON.stringify(received)}`)
			await new Promise<void>((resolve) => {
				waiters.push(resolve)
				setTimeout(resolve, 100)
			})
		}
	}
	return {
		socket,
		received,
		waitFor,
		control: (frame: SyncMuxClientControl) => socket.send(JSON.stringify(frame)),
		send: (id: number, frame: Frame) => socket.send(encodeMuxData(id, JSON.stringify(frame))),
	}
}

const until = async (check: () => Promise<boolean>) => {
	const deadline = Date.now() + 5_000
	while (!(await check())) {
		if (Date.now() > deadline) throw new Error("Timed out")
		await new Promise((resolve) => setTimeout(resolve, 50))
	}
}

describe("the multiplexed socket on workerd", () => {
	it("streams several objects over one socket, live, and closes their sockets with it", async () => {
		await write("mux-a", "a1")
		await write("mux-b", "b1")
		const mux = await connectMux()
		mux.control({ _tag: "Open", id: 1, kind: "org", sourceId: "mux-a", token: "bob" })
		mux.control({ _tag: "Open", id: 2, kind: "org", sourceId: "mux-b", token: "bob" })
		await mux.waitFor(({ id, frame }) => id === undefined && frame._tag === "Opened" && frame.id === 2)
		await mux.waitFor(({ id, frame }) => id === undefined && frame._tag === "Opened" && frame.id === 1)

		mux.send(1, { _tag: "Hello", since: null })
		mux.send(2, { _tag: "Hello", since: null })
		await mux.waitFor(({ id, frame }) => id === 1 && frame._tag === "Ready")
		await mux.waitFor(({ id, frame }) => id === 2 && frame._tag === "Ready")
		const rowsOf = (stream: number) =>
			mux.received
				.filter(({ id, frame }) => id === stream && frame._tag === "Rows")
				.map(({ frame }) => frame.upserts)
		expect(rowsOf(1)).toEqual([[{ id: "a1", name: "a1", private: false }]])
		expect(rowsOf(2)).toEqual([[{ id: "b1", name: "b1", private: false }]])

		// A write after the snapshot reaches its stream, and only its stream.
		const seq = await write("mux-b", "b2")
		await mux.waitFor(({ id, frame }) => id === 2 && frame._tag === "Commit" && frame.seq === seq)
		expect(rowsOf(1)).toHaveLength(1)

		mux.send(1, { _tag: "Ping" })
		await mux.waitFor(({ id, frame }) => id === 1 && frame._tag === "Pong")

		// Closing a stream closes its object's socket; the other stays.
		mux.control({ _tag: "Close", id: 1 })
		await until(async () => (await socketsOf("mux-a")) === 0)
		expect(await socketsOf("mux-b")).toBe(1)

		// The client going closes every object socket.
		mux.socket.close(1000, "done")
		await until(async () => (await socketsOf("mux-b")) === 0)
	})

	it("reports an object's close to its stream with the object's code", async () => {
		const mux = await connectMux()
		mux.control({ _tag: "Open", id: 7, kind: "org", sourceId: "mux-c", token: "bob" })
		await mux.waitFor(({ frame }) => frame._tag === "Opened")
		// The toy source closes a socket whose principal expired with 4001.
		mux.control({ _tag: "Open", id: 8, kind: "org", sourceId: "mux-c", token: "eve&exp=1" })
		const closed = await mux.waitFor(({ frame }) => frame._tag === "Closed" && frame.id === 8)
		expect(closed.frame).toEqual({ _tag: "Closed", id: 8, code: 4001, reason: "token_expired" })
	})
})
