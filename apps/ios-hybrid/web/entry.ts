/**
 * The iOS shell's page: the web app's own entry, live against production (signing in as the native
 * app, `host.ts`), or built `--mode offline` with the offline fixture (`../fixture`) as the page's `fetch` and
 * `WebSocket` (no backend); and the bridge to the SwiftUI shell.
 */
import { forwardConsole, inShell, installBridge } from "./bridge"
import { installHost } from "./host"
import { installPush } from "./push"
import { installWorkerOrigin } from "./worker-origin"

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3003"

const installOffline = async () => {
	const { makeOfflineFetch } = await import("../fixture/offline-backend")
	const { makeFixtureServer, makeFixtureWebSocket } = await import("../fixture/fixture-socket")
	const offline = await import("../fixture/offline-session")
	const server = makeFixtureServer()
	// The performance bar's big channel: #engineering with thousands of messages.
	const { bigChannel } = await import("./big-channel")
	const big = bigChannel(3000)
	server.write("channel", big.channelId, "messages", big.messages)
	server.write("channel", big.channelId, "message_reactions", big.reactions)
	// Pictures for the native list to load: an avatar from the app's bundle and one from the network.
	const { orgId, userRows } = await import("../fixture/snapshot")
	const [, second, third] = userRows
	if (second !== undefined && third !== undefined) {
		server.write("org", orgId, "users", [
			{ ...second, avatarUrl: "/images/squirrle_window.webp" },
			{ ...third, avatarUrl: "https://avatars.githubusercontent.com/u/9919?s=160&v=4" },
		])
	}
	// An HTML render in #general, when the build names a page (`VITE_FIXTURE_HTML`, as served by
	// `apps/ios-hybrid/scripts/serve-fixture-html.ts`).
	const fixtureHtml = import.meta.env.VITE_FIXTURE_HTML
	const render =
		fixtureHtml === undefined
			? undefined
			: (await import("../fixture/html-render-message")).fixtureHtmlRenderAt(fixtureHtml)
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
	const { seedGeneralThread, snapshotWithThread } = await import("../fixture/thread-seed")
	seedGeneralThread(server)
	// The parity harness's page (`compare-pages.ts`): its own rows and RPC answers, if it has any.
	const page = await (await import("../fixture/page-fixture")).loadPageFixture()
	page?.seed?.(server)
	const network = globalThis.fetch.bind(globalThis)
	const offlineFetch = makeOfflineFetch({
		rpcs: page?.rpcs,
		http: page?.http,
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
			snapshot: snapshotWithThread,
		}),
	})
	if (location.pathname === "/" || location.pathname === "/index.html")
		// The channel list: the screen this spike converts.
		history.replaceState(null, "", offline.startPath.replace(/\/chat\/.*$/, "/chat"))
}

forwardConsole()
// Before the app's modules: the local cache starts its OPFS worker as they load.
installWorkerOrigin()
// Live against production unless built `--mode offline` (the fixture, for the simulator).
if (import.meta.env.VITE_HYBRID_OFFLINE === "1") await installOffline()
else {
	installHost()
	installPush()
}
// Only the shell draws the list, the tab bar and pictures natively; a browser keeps the web's own.
if (inShell()) installBridge()
await import("../../web-foldkit/src/entry")
