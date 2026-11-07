/**
 * Hazel on Rune: boots the web app's own init/update/view/subscriptions in Bun and renders through
 * a Foldkit RenderTarget to the native host on stdout. `HAZEL_DATA=offline` (the default) serves a
 * fixture org over a local sync socket; `HAZEL_DATA=live` talks to `VITE_BACKEND_URL` with
 * `HAZEL_SESSION_TOKEN` as the session bearer.
 */
import { appendFileSync } from "node:fs"
import {
	makeElementBridge,
	makeRuneTarget,
	stdioTransport,
	StyleResolver,
	type HostToRuntime,
} from "@hazel/foldkit-rune"
import { installShims } from "./shims"

const width = Number(process.env.NATIVE_WIDTH ?? 1280)
const height = Number(process.env.NATIVE_HEIGHT ?? 800)
const dark = process.env.NATIVE_THEME === "dark"
const dataMode = process.env.HAZEL_DATA === "live" ? "live" : "offline"
const statsPath = process.env.NATIVE_STATS

if (dataMode === "offline") process.env.VITE_BACKEND_URL = "http://offline.hazel.test"
const backendUrl = process.env.VITE_BACKEND_URL ?? "http://localhost:3003"

const offline = await import("./offline-session")
const startPath = process.env.NATIVE_PATH ?? offline.startPath
const shims = installShims({ width, height, dark, url: `http://app.hazel.test${startPath}` })

if (dataMode === "offline") {
	const { makeOfflineFetch } = await import("./offline-backend")
	const { makeFixtureServer, makeFixtureWebSocket } = await import("./fixture/fixture-socket")
	const server = makeFixtureServer()
	globalThis.fetch = makeOfflineFetch({
		backendUrl,
		server,
		user: offline.currentUser,
		onUnknownRpc: (tag) => process.stderr.write(`[offline] rpc ${tag} has no offline answer\n`),
	})
	const FixtureWebSocket = makeFixtureWebSocket({
		server,
		latencyMs: Number(process.env.NATIVE_SYNC_LATENCY_MS ?? 0),
	})
	const DebugWebSocket = class extends FixtureWebSocket {
		override send(data: string) {
			process.stderr.write(`[offline] ws> ${data.slice(0, 120)}\n`)
			super.send(data)
		}
	}
	Object.assign(globalThis, { WebSocket: process.env.NATIVE_DEBUG ? DebugWebSocket : FixtureWebSocket })
} else {
	const token = process.env.HAZEL_SESSION_TOKEN
	if (!token) throw new Error("HAZEL_DATA=live needs HAZEL_SESSION_TOKEN (bun run dev:sign-in prints one)")
	const { setSessionBearerProvider } = await import("../../web-foldkit/src/core/lib/session-bearer")
	setSessionBearerProvider(() => Promise.resolve(token))
	const networkFetch = globalThis.fetch
	globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
		const request = new Request(input, init)
		if (request.url.startsWith(backendUrl)) request.headers.set("authorization", `Bearer ${token}`)
		return networkFetch(request)
	}
}

const { Layer } = await import("effect")
const { Runtime } = await import("foldkit")
const app = await import("../../web-foldkit/src/main")
const { ResourcesLive } = await import("../../web-foldkit/src/rpc")
const { NotificationSinks } = await import("../../web-foldkit/src/app/notification-sinks")
const PendingAnnouncement = await import("../../web-foldkit/src/ui/aria/pending-announcement")

const styles = await StyleResolver.load(new URL("../../web-foldkit/src/styles.css", import.meta.url).pathname)

/** A press on an `href` replays as the click Foldkit's link listener expects on `document`. */
const followLink = (href: string) => {
	const link = Object.assign(new globalThis.Element(), {
		href: new URL(href, location.href).href,
		target: "",
		hasAttribute: () => false,
		closest: () => link,
	})
	const click = new Event("click", { cancelable: true })
	for (const [name, value] of Object.entries({
		target: link,
		button: 0,
		metaKey: false,
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
	})) {
		Object.defineProperty(click, name, { value })
	}
	document.dispatchEvent(click)
}

const composer = await import("./composer")

/** Mounts that only observe geometry run against host-backed element proxies; the editor gets a headless DOM. */
const bridge = makeElementBridge({
	mounts: new Set(["ObserveMessageList"]),
	domMounts: new Map([["MountEditor", composer.makeEditorElement]]),
	sendScroll: (command) => transport.send(command),
	onObserve: () => rune.refreshObserved(),
})
Object.assign(globalThis, {
	ResizeObserver: bridge.ResizeObserver,
	MutationObserver: bridge.MutationObserver,
})
// SAFETY: the app only reads the geometry ProxyElement implements from `getElementById` results.
document.getElementById = (id: string) => bridge.findById(id) as unknown as HTMLElement | null

const treesPath = process.env.NATIVE_TREES_OUT

/** The editor's headless DOM loads once boot goes quiet (250 ms without a commit, at most 2 s in). */
let headlessDomTimer: ReturnType<typeof setTimeout> | undefined
let isHeadlessDomRequested = false
const bootedAt = performance.now()
const scheduleHeadlessDom = () => {
	if (isHeadlessDomRequested) return
	clearTimeout(headlessDomTimer)
	const wait = Math.max(0, Math.min(250, 2000 - (performance.now() - bootedAt)))
	headlessDomTimer = setTimeout(() => {
		isHeadlessDomRequested = true
		const shims = ["Element", "HTMLElement", "Node"].map(
			(name) => (globalThis as Record<string, unknown>)[name],
		)
		void composer.loadHeadlessDom({ document, shims }, () => rune.refreshObserved())
	}, wait)
}
const rune = makeRuneTarget({
	styles,
	bridge,
	editableText: (path) => {
		const mount = bridge.domMountAt(path)
		return mount === undefined ? undefined : composer.editorText(mount.args)
	},
	onEditable: (path, event) => {
		if (process.env.NATIVE_DEBUG) process.stderr.write(`[editable] ${JSON.stringify(event)}\n`)
		const mount = bridge.domMountAt(path)
		if (mount !== undefined) composer.applyEditorEvent(mount.args, event)
	},
	env: { width, height, dark },
	send: (message) => {
		if (treesPath) appendFileSync(treesPath, `${JSON.stringify(message)}\n`)
		transport.send(message)
	},
	onStats: (stats) => {
		scheduleHeadlessDom()
		if (statsPath) {
			const heapUsedMb = process.memoryUsage().heapUsed / 1048576
			appendFileSync(statsPath, `${JSON.stringify({ at: performance.now(), heapUsedMb, ...stats })}\n`)
		}
	},
})

// Created last: the host writes as soon as it starts, and every handler below must exist by then.
const transport = stdioTransport((message: HostToRuntime) => {
	if (message.t === "env")
		shims.updateEnv({ width: message.width, height: message.height, dark: message.dark })
	if (message.t === "event" && message.type === "link" && message.value) {
		followLink(message.value)
		return
	}
	rune.handleHostMessage(message)
})

/** A Message's `_tag` chain and its innermost payload, for the debug log. */
const messageTrail = (message: unknown) => {
	const tags: Array<string> = []
	for (let m = message; typeof m === "object" && m !== null && "_tag" in m;) {
		tags.push(String(m._tag))
		m = "message" in m ? m.message : undefined
	}
	let leaf = message
	while (typeof leaf === "object" && leaf !== null && "message" in leaf) leaf = leaf.message
	return { tags, leaf }
}

Runtime.run(
	Runtime.makeApplication({
		Model: app.Model,
		Flags: app.Flags,
		init: app.init,
		update: process.env.NATIVE_DEBUG
			? (model, message) => {
					const { tags, leaf } = messageTrail(message)
					const detail =
						tags.includes("GotListMessage") || tags.some((t) => t.startsWith("Failed"))
							? ` ${JSON.stringify(leaf).slice(0, 600)}`
							: ""
					process.stderr.write(`[msg] ${performance.now().toFixed(0)} ${tags.join("/")}${detail}\n`)
					return app.update(model, message)
				}
			: app.update,
		view: app.view,
		subscriptions: app.subscriptions,
		resources: Layer.mergeAll(ResourcesLive, NotificationSinks.layer, PendingAnnouncement.layer),
		renderTarget: rune.target,
		routing: {
			onUrlRequest: (request) => app.Message.ClickedLink({ request }),
			onUrlChange: (url) => app.Message.ChangedUrl({ url }),
		},
	}),
	{ flags: app.flags },
)
