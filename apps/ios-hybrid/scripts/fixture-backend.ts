/**
 * The offline fixture as a real backend on localhost: HTTP (`/auth/*`, `/rpc`) from
 * `fixture/offline-backend.ts`, sync sockets (`/sync/mux`, `/sync/<kind>/<id>`) from
 * `fixture/fixture-socket.ts`, over Bun's HTTP and WebSocket server. For the G3 gate (iOS, JSC).
 *
 *   bun scripts/fixture-backend.ts [port] [--dms] [--big] [--thread]   (default 4320; --dms seeds
 *   more DMs, --big gives #engineering 3,000 messages, --thread a thread on #general,
 *   --photos <dir> the dir's .jpg files as image attachments on #general's last message)
 *
 * Server-side changes, to prove liveness (each prints the transaction id):
 *   curl -X POST '127.0.0.1:4320/__fixture/unread?channel=<channel id>'        one more unread
 *   curl -X POST '127.0.0.1:4320/__fixture/rename?channel=<channel id>&name=x' rename a channel
 *   curl -X POST '127.0.0.1:4320/__fixture/dm?channel=<channel id>&text=hi'       a DM's new last message
 *   curl -X POST '127.0.0.1:4320/__fixture/notify?channel=<channel id>&text=hi'  a new mention of Ada
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { basename } from "node:path"
import type { WebSocketLike } from "@hazel/effect-db-collection"
import { fixtureNotifications, makeOfflineFetch } from "../fixture/offline-backend"
import { currentUser } from "../fixture/offline-session"
import { makeFixtureServer, makeFixtureWebSocket } from "../fixture/fixture-socket"
import { seedGeneralThread, snapshotWithThread } from "../fixture/thread-seed"
import { bigChannel } from "../web/big-channel"
import {
	snapshotFor,
	adaUserId,
	channelMemberRows,
	channelRows,
	generalMessageRows,
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
	}): { readonly port: number; stop(): void }
}

const port = Number(process.argv[2] ?? 4320)
const backendUrl = `http://127.0.0.1:${port}`
const server = makeFixtureServer()
// With `--thread`, the thread's own source answers as an empty channel's (`thread-seed.ts`).
const FixtureWebSocket = makeFixtureWebSocket({
	server,
	// History pages as the source objects page it: a 3,000-message snapshot would pass URLSession's
	// 1 MiB WebSocket message limit (close 1009).
	pageSize: 100,
	snapshot: process.argv.includes("--thread") ? snapshotWithThread : snapshotFor,
})
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
// `--thread`: the Benchmarks thread on #general's last message, as the web offline build has it.
if (process.argv.includes("--thread")) seedGeneralThread(server)
// `--big`: #engineering with 3,000 messages (`web/big-channel.ts`), the performance bar's channel.
if (process.argv.includes("--big")) {
	const big = bigChannel(3000)
	server.write("channel", big.channelId, "messages", big.messages)
	server.write("channel", big.channelId, "message_reactions", big.reactions)
}

// `--photos <dir>`: the dir's JPEGs, served at `/__fixture/photo/<name>`, on #general's last message.
const photosIndex = process.argv.indexOf("--photos")
const photosDir = photosIndex === -1 ? undefined : process.argv[photosIndex + 1]
const photoNames =
	photosDir === undefined
		? []
		: readdirSync(photosDir)
				.filter((name) => /\.(jpe?g|png)$/i.test(name))
				.sort()
if (photosDir !== undefined) {
	const names = photoNames
	const last = generalMessageRows.at(-1)
	if (last !== undefined)
		server.write(
			"channel",
			last.channelId,
			"attachments",
			names.map((name, index) => ({
				id: `00000000-0000-4000-8000-0000000d${String(index).padStart(4, "0")}`,
				organizationId: orgId,
				channelId: last.channelId,
				messageId: last.id,
				fileName: name,
				fileSize: statSync(`${photosDir}/${name}`).size,
				externalUrl: `http://127.0.0.1:${port}/__fixture/photo/${encodeURIComponent(name)}`,
				uploadedBy: last.authorId,
				status: "complete",
				uploadedAt: last.createdAt,
				deletedAt: null,
			})),
		)
}

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
		if (photosDir !== undefined && url.pathname.startsWith("/__fixture/photo/")) {
			const name = basename(decodeURIComponent(url.pathname))
			return photoNames.includes(name)
				? new Response(readFileSync(`${photosDir}/${name}`))
				: new Response("no such photo\n", { status: 404 })
		}
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
