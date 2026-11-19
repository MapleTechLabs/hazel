/**
 * The iOS shell's page: the web app's own entry, live against production (signing in as the native
 * app, `host.ts`), or built `--mode offline` with the native app's fixture as the page's `fetch` and
 * `WebSocket` (no backend); and the bridge to the SwiftUI shell.
 */
import { forwardConsole, installBridge } from "./bridge"
import { installHost } from "./host"

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3003"

const installOffline = async () => {
	const { makeOfflineFetch } = await import("../../native/src/offline-backend")
	const { makeFixtureServer, makeFixtureWebSocket } =
		await import("../../native/src/fixture/fixture-socket")
	const offline = await import("../../native/src/offline-session")
	const server = makeFixtureServer()
	// The performance bar's big channel: #engineering with thousands of messages.
	const { bigChannel } = await import("./big-channel")
	const big = bigChannel(3000)
	server.write("channel", big.channelId, "messages", big.messages)
	server.write("channel", big.channelId, "message_reactions", big.reactions)
	// Pictures for the native list to load: an avatar from the app's bundle and one from the network.
	const { orgId, userRows } = await import("../../native/src/fixture/snapshot")
	const [, second, third] = userRows
	if (second !== undefined && third !== undefined) {
		server.write("org", orgId, "users", [
			{ ...second, avatarUrl: "/images/squirrle_window.webp" },
			{ ...third, avatarUrl: "https://avatars.githubusercontent.com/u/9919?s=160&v=4" },
		])
	}
	// An HTML render in #general, when the build names a page (`VITE_FIXTURE_HTML`, as served by
	// `apps/native/scripts/serve-fixture-html.ts`).
	const fixtureHtml = import.meta.env.VITE_FIXTURE_HTML
	const render =
		fixtureHtml === undefined
			? undefined
			: (await import("../../native/src/fixture/html-render-message")).fixtureHtmlRenderAt(fixtureHtml)
	if (render !== undefined) {
		// Three renders in a row, each at its own URL as the api mints one per message.
		const messages = [0, 1, 2].map((n) => ({
			...render.message,
			id: render.message.id.replace(/.$/, String(n + 2)),
			createdAt: new Date(Date.now() - (3 - n) * 60_000).toISOString(),
		}))
		server.write("channel", render.message.channelId, "messages", messages)
	}
	let minted = 0
	const renderUrl =
		render === undefined
			? undefined
			: () => ({ url: `${render.url().url}?n=${++minted}`, expiresAt: render.url().expiresAt })
	// A thread on #general's last message, with a few replies (the offline fixture has none).
	const fixture = await import("../../native/src/fixture/snapshot")
	const threadId = "00000000-0000-4000-8000-0000000e0001"
	const parent = fixture.generalMessageRows.at(-1)
	const [template] = fixture.channelRows
	const [membership] = fixture.channelMemberRows
	if (parent !== undefined && template !== undefined && membership !== undefined) {
		server.write("org", fixture.orgId, "channels", [
			{
				...template,
				id: threadId,
				name: "Benchmarks",
				type: "thread",
				parentChannelId: parent.channelId,
				sectionId: null,
			},
		])
		server.write("org", fixture.orgId, "channel_members", [
			{
				...membership,
				id: "00000000-0000-4000-8000-0000000e0002",
				channelId: threadId,
				notificationCount: 0,
			},
		])
		server.write("channel", parent.channelId, "messages", [{ ...parent, threadChannelId: threadId }])
		const replies = [
			"Which build should I use?",
			"The release one from this morning.",
			"Numbers in an hour.",
		]
		server.write(
			"channel",
			threadId,
			"messages",
			replies.map((content, index) => ({
				...parent,
				id: `00000000-0000-4000-8000-0000000e01${String(index).padStart(2, "0")}`,
				channelId: threadId,
				authorId:
					(fixture.userRows[index % fixture.userRows.length] ?? fixture.userRows[0])?.id ??
					parent.authorId,
				content,
				threadChannelId: null,
				createdAt: new Date(Date.parse(parent.createdAt) + (index + 1) * 60_000).toISOString(),
			})),
		)
	}
	const emptyChannel = fixture.channelRows[1]?.id ?? ""
	const network = globalThis.fetch.bind(globalThis)
	const offlineFetch = makeOfflineFetch({
		htmlRenderUrl: renderUrl,
		backendUrl: BACKEND_URL,
		unfurls: network,
		server,
		user: offline.currentUser,
		onUnknownRpc: (tag) => console.warn(`[offline] rpc ${tag} has no offline answer`),
		onRequest: (method, path) => console.info(`[offline] ${method} ${path}`),
	})
	// The backend is the fixture; the rest of the internet (the emoji picker's CDN) is itself.
	globalThis.fetch = (input, init) => {
		const url = new Request(input, init).url
		if (new URL(url).origin === new URL(BACKEND_URL).origin) return offlineFetch(input, init)
		return network(input, init)
	}
	Object.assign(globalThis, {
		WebSocket: makeFixtureWebSocket({
			server,
			latencyMs: 0,
			// The thread's own source: a channel's tables, as an empty channel has them.
			snapshot: (kind, sourceId) =>
				fixture.snapshotFor(
					kind,
					kind === "channel" && sourceId === threadId ? emptyChannel : sourceId,
				),
		}),
	})
	if (location.pathname === "/" || location.pathname === "/index.html")
		// The channel list: the screen this spike converts.
		history.replaceState(null, "", offline.startPath.replace(/\/chat\/.*$/, "/chat"))
}

forwardConsole()
// Live against production unless built `--mode offline` (the fixture, for the simulator).
if (import.meta.env.VITE_HYBRID_OFFLINE === "1") await installOffline()
else installHost()
installBridge()
await import("../../web-foldkit/src/entry")
