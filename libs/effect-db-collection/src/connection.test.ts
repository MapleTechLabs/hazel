import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SyncConnection, type SyncConnectionOptions } from "./connection"
import { SyncSourceForbiddenError, TxIdTimeoutError } from "./errors"
import { fakeSockets } from "./testing/fake-websocket"

const silent = () => {}

const setup = (overrides: Partial<SyncConnectionOptions> = {}) => {
	const sockets = fakeSockets()
	let tokenCount = 0
	const getToken = vi.fn(async () => `token-${++tokenCount}`)
	const invalidateToken = vi.fn()
	const connection = new SyncConnection({
		kind: "org",
		id: "a",
		baseUrl: "https://sync.test",
		getToken,
		invalidateToken,
		WebSocket: sockets.WebSocket,
		backoff: { initialDelayMs: 1000, maxDelayMs: 30_000, multiplier: 2, jitter: false },
		heartbeatIntervalMs: 25_000,
		log: silent,
		...overrides,
	})
	connection.start()
	return { sockets, connection, getToken, invalidateToken }
}

/** Lets the token read resolve and the socket get created. */
const flush = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
	vi.useFakeTimers()
})
afterEach(() => {
	vi.useRealTimers()
})

describe("SyncConnection", () => {
	it("opens the source URL with the token subprotocol and says Hello from scratch", async () => {
		const { sockets, connection } = setup()
		await flush()
		const socket = sockets.latest("/sync/org/a")!
		expect(socket.url).toBe("wss://sync.test/sync/org/a")
		expect(socket.protocols).toEqual(["hazel.v1", "token-1"])
		socket.open()
		expect(socket.sent).toEqual([{ _tag: "Hello", since: null }])
		expect(connection.status.state).toBe("connecting")
		socket.snapshot(7, {})
		expect(connection.status.state).toBe("ready")
		expect(connection.lastSeq).toBe(7)
	})

	it("reconnects with exponential backoff and resumes after the last seq", async () => {
		const { sockets, connection } = setup()
		await flush()
		sockets.latest("/sync/org/a")!.snapshot(3, {})

		sockets.latest("/sync/org/a")!.serverClose(1006)
		expect(connection.status).toMatchObject({ state: "error", terminal: false, retryInMs: 1000 })
		await vi.advanceTimersByTimeAsync(999)
		expect(sockets.count("/sync/org/a")).toBe(1)
		await vi.advanceTimersByTimeAsync(1)
		expect(sockets.count("/sync/org/a")).toBe(2)

		// Fails again before opening: the delay doubles.
		sockets.latest("/sync/org/a")!.serverClose(1006)
		expect(connection.status).toMatchObject({ state: "error", retryInMs: 2000 })
		await vi.advanceTimersByTimeAsync(2000)
		const socket = sockets.latest("/sync/org/a")!
		expect(sockets.count("/sync/org/a")).toBe(3)
		socket.open()
		expect(socket.sent[0]).toEqual({ _tag: "Hello", since: 3 })

		// A `Ready` resets the backoff.
		socket.receive({ _tag: "Commit", seq: 4 })
		socket.receive({ _tag: "Ready" })
		socket.serverClose(1006)
		expect(connection.status).toMatchObject({ retryInMs: 1000 })
	})

	it("caps the backoff delay", async () => {
		const { sockets, connection } = setup({
			backoff: { initialDelayMs: 1000, maxDelayMs: 4000, multiplier: 2, jitter: false },
		})
		for (let i = 0; i < 5; i++) {
			await flush()
			sockets.latest("/sync/org/a")!.serverClose(1006)
			const status = connection.status
			if (status.state !== "error") throw new Error("expected error")
			await vi.advanceTimersByTimeAsync(status.retryInMs ?? 0)
		}
		expect(connection.status).toMatchObject({ state: "connecting" })
		sockets.latest("/sync/org/a")!.serverClose(1006)
		expect(connection.status).toMatchObject({ retryInMs: 4000 })
	})

	it("reconnects at once with a fresh token on 4001", async () => {
		const { sockets, invalidateToken } = setup()
		await flush()
		sockets.latest("/sync/org/a")!.snapshot(1, {})
		sockets.latest("/sync/org/a")!.serverClose(4001)
		expect(invalidateToken).toHaveBeenCalledWith("token-1")
		await flush()
		const socket = sockets.latest("/sync/org/a")!
		expect(sockets.count("/sync/org/a")).toBe(2)
		expect(socket.protocols).toEqual(["hazel.v1", "token-2"])
		socket.open()
		expect(socket.sent[0]).toEqual({ _tag: "Hello", since: 1 })
	})

	it("refreshes the token in band before the socket expires", async () => {
		const { sockets, connection, invalidateToken } = setup({ heartbeatIntervalMs: 10_000_000 })
		await flush()
		const socket = sockets.latest("/sync/org/a")!
		socket.open()
		socket.commit(1, {}, true)
		socket.receive({ _tag: "Ready", expiresInMs: 300_000 })

		// 30s before expiry: `Reauth` with the next token, on the same socket.
		await vi.advanceTimersByTimeAsync(269_999)
		expect(socket.sent.map((frame) => frame._tag)).toEqual(["Hello"])
		await vi.advanceTimersByTimeAsync(1)
		expect(socket.sent.at(-1)).toEqual({ _tag: "Reauth", token: "token-2" })
		expect(sockets.count("/sync/org/a")).toBe(1)

		// The source moved the expiry: the next refresh follows it.
		socket.receive({ _tag: "Reauthed", expiresInMs: 300_000 })
		await vi.advanceTimersByTimeAsync(270_000)
		expect(socket.sent.at(-1)).toEqual({ _tag: "Reauth", token: "token-3" })

		// A refused refresh closes with 4001: the rejected token is dropped and the socket reopens.
		socket.serverClose(4001)
		expect(invalidateToken).toHaveBeenCalledWith("token-3")
		await flush()
		expect(sockets.count("/sync/org/a")).toBe(2)
		expect(connection.status.state).toBe("connecting")
	})

	it("exchanges again when the cached token is the socket's own, and skips sockets that never expire", async () => {
		let cached = "token-1"
		const getToken = vi.fn(async () => cached)
		const invalidateToken = vi.fn(() => {
			cached = "token-2"
		})
		const { sockets } = setup({ getToken, invalidateToken, heartbeatIntervalMs: 10_000_000 })
		await flush()
		const socket = sockets.latest("/sync/org/a")!
		socket.open()
		socket.commit(1, {}, true)
		socket.receive({ _tag: "Ready", expiresInMs: 60_000 })
		await vi.advanceTimersByTimeAsync(30_000)
		expect(invalidateToken).toHaveBeenCalledWith("token-1")
		expect(socket.sent.at(-1)).toEqual({ _tag: "Reauth", token: "token-2" })

		// `Ready` without an expiry (a session credential, or an older source): no refresh.
		const other = setup({ heartbeatIntervalMs: 10_000_000 })
		await flush()
		other.sockets.latest("/sync/org/a")!.snapshot(1, {})
		await vi.advanceTimersByTimeAsync(10_000_000)
		expect(other.sockets.latest("/sync/org/a")!.sent.map((frame) => frame._tag)).not.toContain("Reauth")
	})

	it("backs off when a fresh token is rejected again", async () => {
		const { sockets, connection } = setup()
		await flush()
		sockets.latest("/sync/org/a")!.serverClose(4001)
		await flush()
		sockets.latest("/sync/org/a")!.serverClose(4001)
		expect(connection.status).toMatchObject({ state: "error", terminal: false })
		await flush()
		expect(sockets.count("/sync/org/a")).toBe(2)
	})

	it("stops for good on 4003 and fails pending waits", async () => {
		const { sockets, connection } = setup()
		await flush()
		const waiting = connection.awaitSeq(10, 60_000)
		sockets.latest("/sync/org/a")!.serverClose(4003, "not a member")
		await expect(waiting).rejects.toBeInstanceOf(SyncSourceForbiddenError)
		expect(connection.status).toMatchObject({ state: "error", terminal: true })
		expect(connection.isSettled).toBe(true)
		await vi.advanceTimersByTimeAsync(120_000)
		expect(sockets.count("/sync/org/a")).toBe(1)
	})

	it("stops on 4004", async () => {
		const { sockets, connection } = setup()
		await flush()
		sockets.latest("/sync/org/a")!.serverClose(4004)
		expect(connection.error?._tag).toBe("SyncSourceNotFoundError")
	})

	it("retries while the token is unavailable or there is no session", async () => {
		const results: Array<string | null> = ["unavailable", null, "t"]
		const { sockets, connection } = setup({ getToken: async () => results.shift() ?? "t" })
		await flush()
		expect(connection.status).toMatchObject({ state: "error" })
		if (connection.status.state === "error")
			expect(connection.status.error._tag).toBe("SyncConnectionError")
		await vi.advanceTimersByTimeAsync(1000)
		await vi.advanceTimersByTimeAsync(2000)
		expect(sockets.count("/sync/org/a")).toBe(1)
		expect(sockets.latest("/sync/org/a")!.protocols).toEqual(["hazel.v1", "t"])
	})

	it("pings and treats a missing pong as a dead socket", async () => {
		const { sockets, connection } = setup()
		await flush()
		const socket = sockets.latest("/sync/org/a")!
		socket.snapshot(1, {})
		await vi.advanceTimersByTimeAsync(25_000)
		expect(socket.sent.at(-1)).toEqual({ _tag: "Ping" })
		socket.receive({ _tag: "Pong" })
		await vi.advanceTimersByTimeAsync(25_000)
		expect(socket.isClosed).toBe(false)
		// No answer to this ping.
		await vi.advanceTimersByTimeAsync(25_000)
		expect(socket.isClosed).toBe(true)
		expect(connection.status).toMatchObject({ state: "error" })
		await vi.advanceTimersByTimeAsync(1000)
		expect(sockets.count("/sync/org/a")).toBe(2)
	})

	it("awaitSeq resolves on a Commit at or past the seq, across resets", async () => {
		const { sockets, connection } = setup()
		await flush()
		const socket = sockets.latest("/sync/org/a")!
		socket.snapshot(2, {})
		await expect(connection.awaitSeq(2, 1000)).resolves.toBeUndefined()

		let resolved = false
		void connection.awaitSeq(5, 10_000).then(() => {
			resolved = true
		})
		socket.commit(4, {})
		await flush()
		expect(resolved).toBe(false)
		// A reset (retention passed `since`) does not break the wait.
		socket.receive({ _tag: "Begin", reset: true })
		socket.receive({ _tag: "Commit", seq: 6 })
		await flush()
		expect(resolved).toBe(true)
	})

	it("awaitSeq times out with TxIdTimeoutError", async () => {
		const { sockets, connection } = setup()
		await flush()
		sockets.latest("/sync/org/a")!.snapshot(1, {})
		const waiting = connection.awaitSeq(9, 5000)
		const assertion = expect(waiting).rejects.toMatchObject({
			_tag: "TxIdTimeoutError",
			txid: "org:a:9",
			timeout: 5000,
		})
		await vi.advanceTimersByTimeAsync(5000)
		await assertion
		await expect(waiting.catch((e) => e)).resolves.toBeInstanceOf(TxIdTimeoutError)
	})

	it("buffers a run until Commit and drops a run cut off by a disconnect", async () => {
		const { sockets, connection } = setup()
		const runs: Array<unknown> = []
		connection.subscribeRuns((run) => runs.push(run))
		await flush()
		const socket = sockets.latest("/sync/org/a")!
		socket.open()
		socket.receive({ _tag: "Begin", reset: true })
		socket.receive({ _tag: "Rows", table: "channels", upserts: [{ id: "c1" }], deletes: [] })
		expect(runs).toHaveLength(0)
		socket.serverClose(1006)
		await vi.advanceTimersByTimeAsync(1000)
		const next = sockets.latest("/sync/org/a")!
		next.open()
		expect(next.sent[0]).toEqual({ _tag: "Hello", since: null })
		next.snapshot(3, { channels: [{ id: "c1" }] })
		expect(runs).toHaveLength(1)
		expect(runs[0]).toMatchObject({ source: "org:a", reset: true, seq: 3 })
	})
})
