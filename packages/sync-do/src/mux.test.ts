/**
 * `GET /sync/mux`'s relay: streams open and close on the client's control frames, frames pass through
 * with their stream id, and an object's close reaches the client with its code.
 */
import { encodeMuxData, type SyncMuxClientControl, type SyncMuxOpen } from "@hazel/domain/sync"
import { Effect, Fiber } from "effect"
import { describe, expect, it } from "vitest"
import { type MuxOpenResult, refuseMuxStream, runMuxSession } from "./mux.ts"

class FakeSocket extends EventTarget {
	readyState = 1
	readonly sent: Array<string> = []
	closedWith: { code: number; reason: string } | undefined

	send(data: string) {
		if (this.readyState !== 1) throw new Error("closed")
		this.sent.push(data)
	}

	close(code = 1000, reason = "") {
		if (this.readyState === 3) return
		this.readyState = 3
		this.closedWith = { code, reason }
	}

	/** A frame from the peer. */
	receive(data: string) {
		this.dispatchEvent(new MessageEvent("message", { data }))
	}

	/** The peer closed the socket. */
	peerClose(code: number, reason = "") {
		this.readyState = 3
		this.dispatchEvent(Object.assign(new Event("close"), { code, reason }))
	}
}

const flush = async () => {
	for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

const control = (frame: SyncMuxClientControl) => JSON.stringify(frame)

const start = (open: (stream: typeof SyncMuxOpen.Type) => Effect.Effect<MuxOpenResult>) => {
	const client = new FakeSocket()
	const fiber = Effect.runFork(runMuxSession(client, open).pipe(Effect.scoped))
	return {
		client,
		fiber,
		controls: () => client.sent.filter((frame) => frame.startsWith("{")).map((f) => JSON.parse(f)),
	}
}

describe("runMuxSession", () => {
	it("opens a source and relays its frames both ways", async () => {
		const upstream = new FakeSocket()
		const opened: Array<[string, string]> = []
		const { client, controls } = start((stream) => {
			opened.push([`${stream.kind}:${stream.sourceId}`, stream.token])
			return Effect.succeed({ _tag: "Opened", socket: upstream })
		})
		client.receive(control({ _tag: "Open", id: 1, kind: "org", sourceId: "o1", token: "t1" }))
		await flush()
		expect(opened).toEqual([["org:o1", "t1"]])
		expect(controls()).toEqual([{ _tag: "Opened", id: 1 }])

		client.receive(encodeMuxData(1, '{"_tag":"Hello","since":null}'))
		upstream.receive('{"_tag":"Ready"}')
		await flush()
		expect(upstream.sent).toEqual(['{"_tag":"Hello","since":null}'])
		expect(client.sent).toContain(encodeMuxData(1, '{"_tag":"Ready"}'))
	})

	it("tells the client a refused source's close code", async () => {
		const { client, controls } = start(() => Effect.succeed(refuseMuxStream(4001, "invalid_token")))
		client.receive(control({ _tag: "Open", id: 1, kind: "user", sourceId: "u1", token: "bad" }))
		await flush()
		expect(controls()).toEqual([{ _tag: "Closed", id: 1, code: 4001, reason: "invalid_token" }])
	})

	it("forwards the object's close and stops relaying the source", async () => {
		const upstream = new FakeSocket()
		const { client, controls } = start(() => Effect.succeed({ _tag: "Opened", socket: upstream }))
		client.receive(control({ _tag: "Open", id: 1, kind: "channel", sourceId: "c1", token: "t" }))
		await flush()
		upstream.peerClose(4003, "forbidden")
		await flush()
		expect(controls()).toContainEqual({ _tag: "Closed", id: 1, code: 4003, reason: "forbidden" })
		client.receive(encodeMuxData(1, '{"_tag":"Ping"}'))
		await flush()
		expect(upstream.sent).toEqual([])
	})

	it("closes a source's object socket when the client closes the source", async () => {
		const upstream = new FakeSocket()
		const { client } = start(() => Effect.succeed({ _tag: "Opened", socket: upstream }))
		client.receive(control({ _tag: "Open", id: 1, kind: "org", sourceId: "o1", token: "t" }))
		await flush()
		client.receive(control({ _tag: "Close", id: 1 }))
		await flush()
		expect(upstream.closedWith).toEqual({ code: 1000, reason: "closed" })
	})

	it("keeps a source's streams apart: a closed stream's frames never reach the next", async () => {
		const sockets = [new FakeSocket(), new FakeSocket()]
		let next = 0
		const { client, controls } = start(() => Effect.succeed({ _tag: "Opened", socket: sockets[next++]! }))
		client.receive(control({ _tag: "Open", id: 1, kind: "org", sourceId: "o1", token: "t" }))
		client.receive(control({ _tag: "Close", id: 1 }))
		client.receive(control({ _tag: "Open", id: 2, kind: "org", sourceId: "o1", token: "t" }))
		await flush()
		expect(sockets[0]!.closedWith?.code).toBe(1000)
		client.receive(encodeMuxData(2, '{"_tag":"Ping"}'))
		sockets[1]!.receive('{"_tag":"Pong"}')
		await flush()
		expect(sockets[0]!.sent).toEqual([])
		expect(sockets[1]!.sent).toEqual(['{"_tag":"Ping"}'])
		expect(client.sent).toContain(encodeMuxData(2, '{"_tag":"Pong"}'))
		expect(controls()).toContainEqual({ _tag: "Opened", id: 2 })
	})

	it("closes every object socket when the client goes", async () => {
		const sockets = [new FakeSocket(), new FakeSocket()]
		let next = 0
		const { client, fiber } = start(() => Effect.succeed({ _tag: "Opened", socket: sockets[next++]! }))
		client.receive(control({ _tag: "Open", id: 1, kind: "org", sourceId: "o1", token: "t" }))
		client.receive(control({ _tag: "Open", id: 2, kind: "org", sourceId: "o2", token: "t" }))
		await flush()
		client.peerClose(1001, "going away")
		await Effect.runPromise(Fiber.await(fiber))
		expect(sockets.map((socket) => socket.closedWith?.code)).toEqual([1000, 1000])
	})
})
