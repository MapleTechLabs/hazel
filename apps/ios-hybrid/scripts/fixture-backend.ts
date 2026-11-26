/**
 * The offline fixture as a real backend on localhost: HTTP (`/auth/*`, `/rpc`) from
 * `fixture/offline-backend.ts`, sync sockets (`/sync/mux`, `/sync/<kind>/<id>`) from
 * `fixture/fixture-socket.ts`, over Bun's HTTP and WebSocket server. For the G3 gate (iOS, JSC).
 *
 *   bun scripts/fixture-backend.ts [port] [--dms]   (default 4320; --dms seeds more DMs, below)
 *
 * Server-side changes, to prove liveness (each prints the transaction id):
 *   curl -X POST '127.0.0.1:4320/__fixture/unread?channel=<channel id>'        one more unread
 *   curl -X POST '127.0.0.1:4320/__fixture/rename?channel=<channel id>&name=x' rename a channel
 *   curl -X POST '127.0.0.1:4320/__fixture/dm?channel=<channel id>&text=hi'       a DM's new last message
 */
import type { WebSocketLike } from "@hazel/effect-db-collection"
import { makeOfflineFetch } from "../fixture/offline-backend"
import { currentUser } from "../fixture/offline-session"
import { makeFixtureServer, makeFixtureWebSocket } from "../fixture/fixture-socket"
import { adaUserId, channelMemberRows, channelRows, orgId, userRows } from "../fixture/snapshot"

/** The slice of Bun's server API used here (the app's tsconfig has no Bun types). */
interface ServerWebSocket<T> {
	readonly data: T
	send(data: string): void
	close(code?: number, reason?: string): void
}
declare const Bun: {
	serve<T>(options: {
		port: number
		hostname: string
		fetch: (
			request: Request,
			server: {
				upgrade(request: Request, options: { data: T; headers: Record<string, string> }): boolean
			},
		) => Response | Promise<Response> | undefined
		websocket: {
			open(ws: ServerWebSocket<T>): void
			message(ws: ServerWebSocket<T>, message: string | Uint8Array): void
			close(ws: ServerWebSocket<T>, code: number): void
		}
	}): { readonly port: number; stop(): void }
}

const port = Number(process.argv[2] ?? 4320)
const backendUrl = `http://127.0.0.1:${port}`
const server = makeFixtureServer()
const FixtureWebSocket = makeFixtureWebSocket({ server })
const offlineFetch = makeOfflineFetch({
	backendUrl,
	user: currentUser,
	server,
	onRequest: (method, path) => console.log(`[http] ${method} ${path}`),
	onUnknownRpc: (tag) => console.log(`[rpc] no fixture answer for ${tag}`),
})

/** Rows as changed so far, so repeated changes build on each other. */
const members = new Map(channelMemberRows.map((row) => [row.id, row]))
const channels = new Map(channelRows.map((row) => [row.id, row]))

/**
 * `--dms`: four more DMs for the DMs screen, written before any client connects so they are part of
 * the snapshot: Katherine (unread), Alan (Ada wrote last), a group with Margaret and Dennis, and
 * Dennis with no message yet. Times are relative to now, so rows read `2h`, `Yesterday`, `Mon`.
 */
const seedDms = () => {
	const userNamed = (firstName: string) =>
		userRows.find((row) => row.firstName === firstName)?.id ?? adaUserId
	const uuid = (group: number, index: number) =>
		`${group.toString(16).padStart(8, "0")}-0000-4000-8000-${index.toString(16).padStart(12, "0")}`
	const now = Date.now()
	const base = channelRows[0]
	const memberBase = channelMemberRows[0]
	if (base === undefined || memberBase === undefined) return
	const seeds = [
		{
			n: 10,
			type: "single",
			with: ["Katherine"],
			at: 2 * 3_600_000,
			from: "Katherine",
			text: "Deck is ready for review 🚀",
			unread: 1,
		},
		{
			n: 11,
			type: "single",
			with: ["Alan"],
			at: 26 * 3_600_000,
			from: "Ada",
			text: "Pushed the fix, can you take a look when you have a minute?",
			unread: 0,
		},
		{
			n: 12,
			type: "direct",
			with: ["Margaret", "Dennis"],
			at: 4 * 86_400_000,
			from: "Margaret",
			text: "Lunch on Friday?",
			unread: 0,
		},
		{ n: 13, type: "single", with: ["Dennis"], at: null, from: null, text: null, unread: 0 },
	] as const
	for (const seed of seeds) {
		const id = uuid(5, seed.n) as (typeof base)["id"]
		const row = {
			...base,
			id,
			name: "",
			type: seed.type,
			sectionId: null,
			lastMessageAt: seed.at === null ? null : new Date(now - seed.at).toISOString(),
			lastMessageAuthorId: seed.from === null ? null : userNamed(seed.from),
			lastMessagePreview: seed.text,
		}
		channels.set(id, row)
		server.write("org", orgId, "channels", [row])
		const rows = [adaUserId, ...seed.with.map(userNamed)].map((userId, index) => ({
			...memberBase,
			id: uuid(7, seed.n * 16 + index + 1),
			channelId: id,
			userId,
			isFavorite: false,
			notificationCount: userId === adaUserId ? seed.unread : 0,
		}))
		for (const member of rows) members.set(member.id, member)
		server.write("org", orgId, "channel_members", rows)
	}
}
if (process.argv.includes("--dms")) seedDms()

const change = (url: URL): Response => {
	const channelId = url.searchParams.get("channel") ?? ""
	if (url.pathname === "/__fixture/unread") {
		const member = [...members.values()].find(
			(row) => row.channelId === channelId && row.userId === adaUserId,
		)
		if (member === undefined) return new Response("no such membership\n", { status: 404 })
		const next = { ...member, notificationCount: member.notificationCount + 1 }
		members.set(next.id, next)
		const tx = server.write("org", orgId, "channel_members", [next])
		return new Response(`${tx} unread=${next.notificationCount}\n`)
	}
	if (url.pathname === "/__fixture/rename") {
		const channel = channels.get(channelId as never)
		if (channel === undefined) return new Response("no such channel\n", { status: 404 })
		const next = { ...channel, name: url.searchParams.get("name") ?? `${channel.name}-renamed` }
		channels.set(next.id, next)
		const tx = server.write("org", orgId, "channels", [next])
		return new Response(`${tx} name=${next.name}\n`)
	}
	if (url.pathname === "/__fixture/dm") {
		// The newest message from the DM's first other member: the preview, its time, one more unread.
		const channel = channels.get(channelId as never)
		const author = [...members.values()].find(
			(row) => row.channelId === channelId && row.userId !== adaUserId,
		)
		const mine = [...members.values()].find(
			(row) => row.channelId === channelId && row.userId === adaUserId,
		)
		if (channel === undefined || author === undefined || mine === undefined)
			return new Response("no such DM\n", { status: 404 })
		const next = {
			...channel,
			lastMessageAt: new Date().toISOString(),
			lastMessageAuthorId: author.userId,
			lastMessagePreview: url.searchParams.get("text") ?? "New message",
		}
		const member = { ...mine, notificationCount: mine.notificationCount + 1 }
		channels.set(next.id, next)
		members.set(member.id, member)
		server.write("org", orgId, "channels", [next])
		const tx = server.write("org", orgId, "channel_members", [member])
		return new Response(`${tx} preview=${next.lastMessagePreview} unread=${member.notificationCount}\n`)
	}
	return new Response("unknown change\n", { status: 404 })
}

type SocketData = { readonly url: string; readonly protocols: Array<string>; fixture?: WebSocketLike }

Bun.serve<SocketData>({
	port,
	hostname: "127.0.0.1",
	fetch: (request, bun) => {
		const url = new URL(request.url)
		if (url.pathname.startsWith("/sync/")) {
			const protocols = (request.headers.get("sec-websocket-protocol") ?? "")
				.split(",")
				.map((part) => part.trim())
				.filter((part) => part !== "")
			const upgraded = bun.upgrade(request, {
				data: { url: `ws://127.0.0.1:${port}${url.pathname}`, protocols },
				// The first offered subprotocol is the protocol version; the second is the token.
				headers: protocols[0] === undefined ? {} : { "Sec-WebSocket-Protocol": protocols[0] },
			})
			return upgraded ? undefined : new Response("upgrade failed", { status: 400 })
		}
		if (request.method === "POST" && url.pathname.startsWith("/__fixture/")) return change(url)
		if (url.pathname === "/health") return new Response("ok\n")
		return offlineFetch(request)
	},
	websocket: {
		open: (ws: ServerWebSocket<SocketData>) => {
			console.log(`[ws] open ${ws.data.url} [${ws.data.protocols[0] ?? ""}]`)
			const fixture = new FixtureWebSocket(ws.data.url, ws.data.protocols)
			fixture.onmessage = ({ data }) => void ws.send(String(data))
			fixture.onclose = ({ code, reason }) => ws.close(code, reason)
			ws.data.fixture = fixture
		},
		message: (ws: ServerWebSocket<SocketData>, message) => {
			const fixture = ws.data.fixture
			if (fixture === undefined) return
			const send = () => fixture.send(String(message))
			// The fixture socket opens on a microtask; a frame sent first waits for it.
			if (fixture.readyState === 1) send()
			else queueMicrotask(send)
		},
		close: (ws: ServerWebSocket<SocketData>, code) => {
			console.log(`[ws] close ${ws.data.url} ${code}`)
			ws.data.fixture?.close()
		},
	},
})

console.log(`fixture backend on ${backendUrl} (org ${orgId}, user ${adaUserId})`)
