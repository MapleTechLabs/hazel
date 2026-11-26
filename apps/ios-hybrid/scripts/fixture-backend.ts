/**
 * The offline fixture as a real backend on localhost: HTTP (`/auth/*`, `/rpc`) from
 * `fixture/offline-backend.ts`, sync sockets (`/sync/mux`, `/sync/<kind>/<id>`) from
 * `fixture/fixture-socket.ts`, over Bun's HTTP and WebSocket server. For the G3 gate (iOS, JSC).
 *
 *   bun scripts/fixture-backend.ts [port]       (default 4320)
 *
 * Server-side changes, to prove liveness (each prints the transaction id):
 *   curl -X POST '127.0.0.1:4320/__fixture/unread?channel=<channel id>'        one more unread
 *   curl -X POST '127.0.0.1:4320/__fixture/rename?channel=<channel id>&name=x' rename a channel
 *   curl -X POST '127.0.0.1:4320/__fixture/notify?channel=<channel id>&text=hi'  a new mention of Ada
 */
import type { WebSocketLike } from "@hazel/effect-db-collection"
import { fixtureNotifications, makeOfflineFetch } from "../fixture/offline-backend"
import { currentUser } from "../fixture/offline-session"
import { makeFixtureServer, makeFixtureWebSocket } from "../fixture/fixture-socket"
import {
	adaUserId,
	channelMemberRows,
	channelRows,
	notificationRows,
	orgId,
	userRows,
} from "../fixture/snapshot"

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
	}): unknown
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
	if (url.pathname === "/__fixture/notify") {
		// A message in the channel that mentions Ada, and her notification for it.
		const channel = channels.get(channelId as never)
		const [template] = notificationRows
		const author = userRows.find((row) => row.id !== adaUserId)
		if (channel === undefined || template === undefined || author === undefined)
			return new Response("no such channel\n", { status: 404 })
		const now = new Date().toISOString()
		const messageId = crypto.randomUUID()
		server.write("channel", channel.id, "messages", [
			{
				id: messageId,
				channelId: channel.id,
				conversationId: null,
				authorId: author.id,
				content: `@[userId:${adaUserId}] ${url.searchParams.get("text") ?? "are you around?"}`,
				embeds: null,
				replyToMessageId: null,
				threadChannelId: null,
				createdAt: now,
				updatedAt: null,
				deletedAt: null,
			},
		])
		const notification = {
			...template,
			id: crypto.randomUUID(),
			targetedResourceId: channel.id,
			resourceId: messageId,
			reason: "mention",
			createdAt: now,
			readAt: null,
		}
		fixtureNotifications.set(notification.id, notification)
		const tx = server.write("user", adaUserId, "notifications", [notification])
		return new Response(`${tx} notification=${notification.id}\n`)
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
