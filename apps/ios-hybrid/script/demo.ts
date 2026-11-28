/**
 * The demo build (`release.sh` with `DEMO=1`): the app on the offline fixture, in-process, for a
 * recording with no server and no real account. It wraps the host's `__native` bridge: HTTP and
 * sockets answer from the fixture (`../fixture`, as `scripts/fixture-backend.ts` serves them), the
 * API is the fixture's with its stand-in user, and the keychain reads as empty (a real session
 * stays untouched).
 */
import type {
	NativeBridge,
	NativeHttpEvent,
	NativeSocketEvent,
} from "../../../packages/client-data/src/platform/jsc/bridge.ts"
import { seedDms } from "../fixture/dm-seed"
import { makeFixtureServer, makeFixtureWebSocket } from "../fixture/fixture-socket"
import { makeOfflineFetch } from "../fixture/offline-backend"
import { currentUser } from "../fixture/offline-session"
import { seedGeneralThread, snapshotWithThread } from "../fixture/thread-seed"

/** The slice of the Fetch API the fixture uses: a bare JavaScriptCore context has none of it. */
class DemoHeaders {
	readonly values = new Map<string, string>()
	constructor(init?: Record<string, string> | DemoHeaders) {
		const entries = init instanceof DemoHeaders ? init.values : Object.entries(init ?? {})
		for (const [name, value] of entries) this.values.set(name.toLowerCase(), value)
	}
	get(name: string) {
		return this.values.get(name.toLowerCase()) ?? null
	}
	set(name: string, value: string) {
		this.values.set(name.toLowerCase(), value)
	}
	has(name: string) {
		return this.values.has(name.toLowerCase())
	}
	forEach(each: (value: string, name: string) => void) {
		this.values.forEach(each)
	}
	record(): Record<string, string> {
		return Object.fromEntries(this.values)
	}
}

const textOf = (body: unknown): string =>
	body === undefined || body === null
		? ""
		: typeof body === "string"
			? body
			: new TextDecoder().decode(body as Uint8Array)

class DemoRequest {
	readonly url: string
	readonly method: string
	readonly headers: DemoHeaders
	private readonly body: string
	constructor(
		input: string | { readonly url: string },
		init?: { method?: string; headers?: never; body?: unknown },
	) {
		this.url = typeof input === "string" ? input : input.url
		this.method = init?.method ?? "GET"
		this.headers = new DemoHeaders(init?.headers)
		this.body = textOf(init?.body)
	}
	async text() {
		return this.body
	}
	async json() {
		return JSON.parse(this.body) as unknown
	}
}

class DemoResponse {
	readonly status: number
	readonly headers: DemoHeaders
	private readonly body: string
	constructor(body?: string | null, init?: { status?: number; headers?: Record<string, string> }) {
		this.body = body ?? ""
		this.status = init?.status ?? 200
		this.headers = new DemoHeaders(init?.headers)
	}
	get ok() {
		return this.status >= 200 && this.status < 300
	}
	static json(value: unknown, init?: { status?: number; headers?: Record<string, string> }) {
		return new DemoResponse(JSON.stringify(value), {
			...init,
			headers: { "content-type": "application/json", ...init?.headers },
		})
	}
	async text() {
		return this.body
	}
	async json() {
		return JSON.parse(this.body) as unknown
	}
}

/** Where the demo pretends the API is: loopback, so the host passes the stand-in token through. */
const DEMO_API = "http://127.0.0.1:4320"

declare const __native: NativeBridge

/** Installs the fixture under the host's bridge; run before any platform service starts. */
export const installDemo = () => {
	const global = globalThis as Record<string, unknown>
	global.Request ??= DemoRequest
	global.Response ??= DemoResponse
	global.Headers ??= DemoHeaders

	const server = makeFixtureServer()
	// The demo's extras: more DMs (one unread) and the Benchmarks thread on #general.
	seedDms(server)
	seedGeneralThread(server)
	const FixtureWebSocket = makeFixtureWebSocket({ server, pageSize: 100, snapshot: snapshotWithThread })
	const offlineFetch = makeOfflineFetch({ backendUrl: DEMO_API, user: currentUser, server })

	const real = __native
	let nextId = 1
	const http: NativeBridge["http"] = {
		start: (method, url, headers, body, onEvent: (event: NativeHttpEvent) => void) => {
			const id = nextId++
			offlineFetch(url, { method, headers, body: body ?? undefined } as RequestInit)
				.then(async (response) => {
					const head = response as unknown as DemoResponse
					onEvent({ type: "head", status: head.status, url, headers: head.headers.record() })
					onEvent({ type: "chunk", data: new TextEncoder().encode(await head.text()) })
					onEvent({ type: "end" })
				})
				.catch((error: unknown) => onEvent({ type: "error", message: String(error) }))
			return id
		},
		cancel: () => {},
	}
	const sockets = new Map<number, WebSocket>()
	const socket: NativeBridge["socket"] = {
		open: (url, protocols, onEvent: (event: NativeSocketEvent) => void) => {
			const id = nextId++
			const ws = new FixtureWebSocket(url, protocols) as unknown as WebSocket
			ws.onopen = () => onEvent({ type: "open", protocol: "" })
			ws.onmessage = (event) => onEvent({ type: "message", data: event.data as string | ArrayBuffer })
			ws.onclose = (event) => {
				sockets.delete(id)
				onEvent({ type: "close", code: event.code, reason: event.reason })
			}
			ws.onerror = () => onEvent({ type: "error", message: "fixture socket error" })
			sockets.set(id, ws)
			return id
		},
		send: (id, data) => sockets.get(id)?.send(data as string),
		close: (id, code, reason) => sockets.get(id)?.close(code, reason),
	}
	// An empty keychain: the stand-in user signs in, and the real session is neither read nor replaced.
	const session: NativeBridge["session"] = {
		read: () => null,
		write: () => true,
		clear: () => {},
		rejected: () => {},
	}
	const config = { apiUrl: DEMO_API, token: "fixture" }
	global.__native = Object.assign(Object.create(real) as NativeBridge, { http, socket, session, config })
	console.log("[hazel] demo: the offline fixture, in-process")
}
