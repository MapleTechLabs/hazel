import { encodeMuxData, type SyncServerFrame } from "@hazel/domain/sync"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SyncHub } from "./hub"
import { type FakeSocket, fakeSockets } from "./testing/fake-websocket"

const silent = () => {}

const setup = () => {
	const sockets = fakeSockets()
	let tokenCount = 0
	const invalidateToken = vi.fn()
	const hub = new SyncHub({
		baseUrl: "https://sync.test",
		getToken: async () => `token-${++tokenCount}`,
		invalidateToken,
		WebSocket: sockets.WebSocket,
		multiplex: true,
		backoff: { initialDelayMs: 1000, maxDelayMs: 30_000, multiplier: 2, jitter: false },
		releaseGraceMs: 0,
		log: silent,
	})
	return { sockets, hub, invalidateToken }
}

/** Lets the token reads resolve and the streams get created. */
const flush = () => vi.advanceTimersByTimeAsync(0)

const send = (socket: FakeSocket, id: number, frame: SyncServerFrame) =>
	socket.receiveRaw(encodeMuxData(id, JSON.stringify(frame)))

/** Opens stream `id` and sends it a snapshot at `seq`. */
const snapshot = (socket: FakeSocket, id: number, seq: number) => {
	socket.receive({ _tag: "Opened", id })
	send(socket, id, { _tag: "Begin", reset: true })
	send(socket, id, { _tag: "Commit", seq } as SyncServerFrame)
	send(socket, id, { _tag: "Ready" })
}

const opens = (socket: FakeSocket) => socket.sent.filter((frame) => frame._tag === "Open")

beforeEach(() => {
	vi.useFakeTimers()
})
afterEach(() => {
	vi.useRealTimers()
})

describe("SyncMux", () => {
	it("carries every source over one socket, opened with the mux subprotocol", async () => {
		const { sockets, hub } = setup()
		const user = hub.acquire("user", "u")
		const org = hub.acquire("org", "o")
		await flush()
		expect(sockets.all).toHaveLength(1)
		const socket = sockets.all[0]!
		expect(socket.url).toBe("wss://sync.test/sync/mux")
		expect(socket.protocols).toEqual(["hazel.mux.v1", "token-1"])

		socket.open()
		const hello = JSON.stringify({ _tag: "Hello", since: null, paging: true })
		// The Hello rides with the open: the snapshot answers the same round trip.
		expect(opens(socket)).toEqual([
			{ _tag: "Open", id: 0, kind: "user", sourceId: "u", token: "token-1", hello },
			{ _tag: "Open", id: 1, kind: "org", sourceId: "o", token: "token-2", hello },
		])
		// A Worker that forwarded it: nothing more to send.
		socket.receive({ _tag: "Opened", id: 0, hello: true })
		expect(socket.sentRaw).not.toContain(encodeMuxData(0, hello))
		// One that predates it: the client sends it on `Opened`, as before.
		socket.receive({ _tag: "Opened", id: 1 })
		expect(socket.sentRaw.filter((frame) => frame === encodeMuxData(1, hello))).toHaveLength(1)

		snapshot(socket, 0, 4)
		snapshot(socket, 1, 9)
		expect(user.connection.status.state).toBe("ready")
		expect(org.connection.lastSeq).toBe(9)
	})

	it("closes a stream with the code its source refused it with", async () => {
		const { sockets, hub } = setup()
		const org = hub.acquire("org", "o")
		await flush()
		const socket = sockets.all[0]!
		socket.open()
		socket.receive({ _tag: "Closed", id: 0, code: 4003, reason: "forbidden" })
		expect(org.connection.error?._tag).toBe("SyncSourceForbiddenError")
	})

	it("reconnects every source through a new socket when the shared one drops", async () => {
		const { sockets, hub } = setup()
		const user = hub.acquire("user", "u")
		const org = hub.acquire("org", "o")
		await flush()
		const first = sockets.all[0]!
		first.open()
		snapshot(first, 0, 4)
		snapshot(first, 1, 9)

		first.serverClose(1006)
		expect(user.connection.status.state).toBe("error")
		await vi.advanceTimersByTimeAsync(1000)
		expect(sockets.all).toHaveLength(2)
		const second = sockets.all[1]!
		second.open()
		// New streams, resuming where each source left off.
		expect(opens(second).map((frame) => frame.id)).toEqual([2, 3])
		second.receive({ _tag: "Opened", id: 3 })
		expect(second.sentRaw).toContain(
			encodeMuxData(3, JSON.stringify({ _tag: "Hello", since: 9, paging: true })),
		)
		expect(org.connection.status.state).toBe("connecting")
	})

	it("takes a socket that went quiet for dead: every source reconnects through a new one", async () => {
		const { sockets, hub } = setup()
		const user = hub.acquire("user", "u")
		await flush()
		const first = sockets.all[0]!
		first.open()
		snapshot(first, 0, 4)

		// Asleep, or a network change the browser has not noticed: the next stream never opens.
		await vi.advanceTimersByTimeAsync(60_000)
		const org = hub.acquire("org", "o")
		await flush()
		await vi.advanceTimersByTimeAsync(15_000)
		expect(first.closedWith).toEqual({ code: 1000, reason: "unresponsive" })

		await vi.advanceTimersByTimeAsync(2000)
		expect(sockets.all).toHaveLength(2)
		const second = sockets.all[1]!
		second.open()
		expect(
			opens(second)
				.map((frame) => frame.sourceId)
				.sort(),
		).toEqual(["o", "u"])
		snapshot(second, opens(second)[0]!.id as number, 5)
		snapshot(second, opens(second)[1]!.id as number, 9)
		expect(user.connection.status.state).toBe("ready")
		expect(org.connection.status.state).toBe("ready")
	})

	it("retries only the late stream while the socket still talks", async () => {
		const { sockets, hub } = setup()
		const user = hub.acquire("user", "u")
		const org = hub.acquire("org", "o")
		await flush()
		const socket = sockets.all[0]!
		socket.open()
		snapshot(socket, 0, 4)

		await vi.advanceTimersByTimeAsync(15_000)
		expect(socket.isClosed).toBe(false)
		expect(socket.sent.at(-1)).toEqual({ _tag: "Close", id: 1 })
		expect(user.connection.status.state).toBe("ready")
		expect(org.connection.status.state).toBe("error")
		await vi.advanceTimersByTimeAsync(1000)
		expect(opens(socket).map((frame) => frame.sourceId)).toEqual(["u", "o", "o"])
	})

	it("gives up on a handshake that never completes", async () => {
		const { sockets, hub } = setup()
		const org = hub.acquire("org", "o")
		await flush()
		await vi.advanceTimersByTimeAsync(15_000)
		expect(sockets.all[0]!.closedWith).toEqual({ code: 1000, reason: "timeout" })
		expect(org.connection.status.state).toBe("error")
		await vi.advanceTimersByTimeAsync(1000)
		expect(sockets.all).toHaveLength(2)
	})

	it("ignores a closed stream's late frames and closes the socket once idle", async () => {
		const { sockets, hub } = setup()
		const org = hub.acquire("org", "o")
		await flush()
		const socket = sockets.all[0]!
		socket.open()
		snapshot(socket, 0, 4)

		org.release()
		expect(socket.sent.at(-1)).toEqual({ _tag: "Close", id: 0 })
		send(socket, 0, { _tag: "Begin", reset: true })
		expect(socket.isClosed).toBe(false)
		await vi.advanceTimersByTimeAsync(10_000)
		expect(socket.closedWith).toEqual({ code: 1000, reason: "idle" })
	})

	it("passes a refused socket token to every stream, which exchange a fresh one", async () => {
		const { sockets, hub, invalidateToken } = setup()
		hub.acquire("org", "o")
		await flush()
		sockets.all[0]!.serverClose(4001, "invalid_token")
		expect(invalidateToken).toHaveBeenCalledWith("token-1")
		await flush()
		expect(sockets.all).toHaveLength(2)
		expect(sockets.all[1]!.protocols).toEqual(["hazel.mux.v1", "token-2"])
	})
})
