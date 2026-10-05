import { describe, expect, it } from "vitest"
import { decodeHandshake, encodeHandshake, type Handshake } from "./handshake.ts"
import { SESSION_CONFLICT_REASON } from "./log.ts"
import {
	type AuthResult,
	type RelayClock,
	type RelaySocket,
	relayCloseCode,
	startRelay,
	type UpstreamResult,
} from "./relay.ts"

class FakeSocket implements RelaySocket {
	readonly sent: Array<string> = []
	closed: { code: number; reason: string } | undefined
	private messageListeners: Array<(data: string) => void> = []
	private closeListeners: Array<(code: number, reason: string) => void> = []

	send(data: string) {
		this.sent.push(data)
	}
	close(code: number, reason: string) {
		this.closed ??= { code, reason }
	}
	onMessage(listener: (data: string) => void) {
		this.messageListeners.push(listener)
	}
	onClose(listener: (code: number, reason: string) => void) {
		this.closeListeners.push(listener)
	}
	/** The peer sent `frame`. */
	receive(frame: object | string) {
		const data = typeof frame === "string" ? frame : JSON.stringify(frame)
		for (const listener of this.messageListeners) listener(data)
	}
	/** The peer closed. */
	peerClose(code = 1000, reason = "") {
		for (const listener of this.closeListeners) listener(code, reason)
	}
	frames() {
		return this.sent.map((data) => JSON.parse(data) as { op: string } & Record<string, unknown>)
	}
}

const fakeClock = () => {
	let now = 0
	const intervals: Array<() => void> = []
	const clock: RelayClock = {
		now: () => now,
		setInterval: (fn) => intervals.push(fn),
		clearInterval: () => undefined,
	}
	return {
		clock,
		advance: (ms: number) => {
			now += ms
			for (const fn of intervals) fn()
		},
	}
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

const BOT = { _tag: "Authenticated", botId: "00000000-0000-4000-8000-000000000111", botName: "echo" } as const

const setup = (options?: {
	auth?: (token: string) => Promise<AuthResult>
	connect?: (handshake: Handshake) => Promise<UpstreamResult>
}) => {
	const client = new FakeSocket()
	const upstream = new FakeSocket()
	const handshakes: Array<Handshake> = []
	const { clock, advance } = fakeClock()
	const relay = startRelay({
		client,
		heartbeatIntervalMs: 25_000,
		leaseTtlMs: 75_000,
		clock,
		authenticate: options?.auth ?? (async () => BOT),
		connect: async (handshake) => {
			handshakes.push(handshake)
			return options?.connect ? options.connect(handshake) : { _tag: "Connected", socket: upstream }
		},
	})
	return { client, upstream, handshakes, relay, advance }
}

describe("gateway relay", () => {
	it("greets with HELLO and answers heartbeats itself, before and after identify", async () => {
		const { client, upstream } = setup()
		expect(client.frames()[0]).toEqual({ op: "HELLO", heartbeatIntervalMs: 25_000 })

		client.receive({ op: "HEARTBEAT" })
		expect(client.frames()[1]).toEqual({ op: "HEARTBEAT_ACK" })

		client.receive({ op: "IDENTIFY", botToken: "hzl_bot_x", resumeOffset: "now" })
		await flush()
		client.receive({ op: "HEARTBEAT", sessionId: "s1" })
		expect(client.frames().at(-1)).toEqual({ op: "HEARTBEAT_ACK", sessionId: "s1" })
		expect(upstream.sent).toEqual([])
	})

	it("authenticates IDENTIFY, opens the bot's session and relays both ways", async () => {
		const tokens: Array<string> = []
		const { client, upstream, handshakes, relay } = setup({
			auth: async (token) => {
				tokens.push(token)
				return BOT
			},
		})
		client.receive({ op: "IDENTIFY", botToken: "hzl_bot_x", resumeOffset: "-1" })
		await flush()

		expect(tokens).toEqual(["hzl_bot_x"])
		expect(handshakes).toEqual([
			{ botId: BOT.botId, botName: "echo", request: { op: "IDENTIFY", resumeOffset: "-1" } },
		])
		expect(relay.phase()).toBe("relaying")

		const ready = JSON.stringify({ op: "READY", sessionId: "s1", resumed: false, resumeOffset: "-1" })
		upstream.receive(ready)
		expect(client.sent.at(-1)).toBe(ready)

		const ack = { op: "ACK", sessionId: "s1", nextOffset: "0000000000000002" }
		client.receive(ack)
		expect(upstream.frames()).toEqual([ack])
	})

	it("passes RESUME's session id and offset through", async () => {
		const { client, handshakes } = setup()
		client.receive({ op: "RESUME", botToken: "t", sessionId: "s9", resumeOffset: "0000000000000007" })
		await flush()
		expect(handshakes[0]?.request).toEqual({
			op: "RESUME",
			sessionId: "s9",
			resumeOffset: "0000000000000007",
		})
	})

	it("rejects an invalid token with INVALID_SESSION", async () => {
		const { client, handshakes } = setup({
			auth: async () => ({ _tag: "Rejected", reason: "Invalid bot token" }),
		})
		client.receive({ op: "IDENTIFY", botToken: "nope", resumeOffset: "now" })
		await flush()
		expect(client.frames().at(-1)).toEqual({ op: "INVALID_SESSION", reason: "Invalid bot token" })
		expect(client.closed?.code).toBe(1008)
		expect(handshakes).toEqual([])
	})

	it("relays the object's session-conflict rejection", async () => {
		const { client } = setup({
			connect: async () => ({ _tag: "Rejected", reason: SESSION_CONFLICT_REASON }),
		})
		client.receive({ op: "IDENTIFY", botToken: "t", resumeOffset: "now" })
		await flush()
		expect(client.frames().at(-1)).toEqual({ op: "INVALID_SESSION", reason: SESSION_CONFLICT_REASON })
		expect(client.closed?.code).toBe(1008)
	})

	it("asks the bot to reconnect when the database or object is unavailable", async () => {
		const down = setup({ auth: async () => ({ _tag: "Unavailable", reason: "db down" }) })
		down.client.receive({ op: "IDENTIFY", botToken: "t", resumeOffset: "now" })
		await flush()
		expect(down.client.frames().at(-1)).toEqual({ op: "RECONNECT", reason: "gateway_unavailable" })
		expect(down.client.closed?.code).toBe(1012)

		const thrown = setup({
			connect: async () => {
				throw new Error("boom")
			},
		})
		thrown.client.receive({ op: "IDENTIFY", botToken: "t", resumeOffset: "now" })
		await flush()
		expect(thrown.client.frames().at(-1)?.op).toBe("RECONNECT")
	})

	it("rejects undecodable frames like the Bun gateway did", () => {
		const { client } = setup()
		client.receive("not json")
		expect(client.frames().at(-1)?.op).toBe("INVALID_SESSION")
		expect(client.closed?.code).toBe(1008)
	})

	it("refuses a second IDENTIFY on an identified connection", async () => {
		const { client, upstream } = setup()
		client.receive({ op: "IDENTIFY", botToken: "t", resumeOffset: "now" })
		await flush()
		client.receive({ op: "IDENTIFY", botToken: "t", resumeOffset: "now" })
		expect(client.frames().at(-1)).toEqual({
			op: "INVALID_SESSION",
			reason: "session already identified",
		})
		expect(upstream.closed?.code).toBe(1008)
	})

	it("propagates closes in both directions", async () => {
		const a = setup()
		a.client.receive({ op: "IDENTIFY", botToken: "t", resumeOffset: "now" })
		await flush()
		a.upstream.peerClose(1012, "Timed out waiting for ACK")
		expect(a.client.closed).toEqual({ code: 1012, reason: "Timed out waiting for ACK" })

		const b = setup()
		b.client.receive({ op: "IDENTIFY", botToken: "t", resumeOffset: "now" })
		await flush()
		b.client.peerClose(1006)
		expect(b.upstream.closed?.code).toBe(1000)
		expect(b.relay.phase()).toBe("closed")
	})

	it("closes an upstream that connects after the client left", async () => {
		let release!: () => void
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		const upstream = new FakeSocket()
		const { client } = setup({
			connect: async () => {
				await gate
				return { _tag: "Connected", socket: upstream }
			},
		})
		client.receive({ op: "IDENTIFY", botToken: "t", resumeOffset: "now" })
		await flush()
		client.peerClose()
		release()
		await flush()
		expect(upstream.closed?.code).toBe(1000)
	})

	it("disconnects a client silent for the lease TTL, freeing the bot", async () => {
		const { client, upstream, advance } = setup()
		client.receive({ op: "IDENTIFY", botToken: "t", resumeOffset: "now" })
		await flush()
		advance(50_000)
		expect(client.closed).toBeUndefined()
		client.receive({ op: "HEARTBEAT", sessionId: "s1" })
		advance(50_000)
		expect(client.closed).toBeUndefined()
		advance(30_000)
		expect(client.closed).toEqual({ code: 1001, reason: "heartbeat_timeout" })
		expect(upstream.closed?.code).toBe(1001)
	})

	it("maps close codes a server may not send", () => {
		expect(relayCloseCode(1000)).toBe(1000)
		expect(relayCloseCode(1008)).toBe(1008)
		expect(relayCloseCode(4001)).toBe(4001)
		expect(relayCloseCode(1005)).toBe(1012)
		expect(relayCloseCode(1006)).toBe(1012)
	})
})

describe("handshake headers", () => {
	it("round-trips IDENTIFY and RESUME, including free-text bot names", () => {
		const identify: Handshake = {
			botId: BOT.botId,
			botName: "Échø bot ✨",
			request: { op: "IDENTIFY", resumeOffset: "now" },
		}
		const resume: Handshake = {
			botId: BOT.botId,
			botName: "echo",
			request: { op: "RESUME", sessionId: "s1", resumeOffset: "0000000000000003" },
		}
		const lower = (headers: Record<string, string>) =>
			Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]))
		expect(decodeHandshake(lower(encodeHandshake(identify)))).toEqual(identify)
		expect(decodeHandshake(lower(encodeHandshake(resume)))).toEqual(resume)
	})

	it("rejects incomplete handshakes", () => {
		expect(decodeHandshake({})).toBeUndefined()
		expect(
			decodeHandshake({
				"x-hazel-bot-id": "b",
				"x-hazel-bot-name": "n",
				"x-hazel-gateway-op": "RESUME",
				"x-hazel-gateway-resume-offset": "now",
			}),
		).toBeUndefined()
	})
})
