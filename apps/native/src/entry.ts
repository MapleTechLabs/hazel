/**
 * Hazel on Rune: boots the web app's own init/update/view/subscriptions in Bun and renders through
 * a Foldkit RenderTarget to the native host on stdout. `HAZEL_DATA=offline` (the default) serves a
 * fixture org over a local sync socket; `HAZEL_DATA=live` talks to `VITE_BACKEND_URL` with
 * `HAZEL_SESSION_TOKEN` as the session bearer, or without one signs in through the browser and
 * keeps the session in the macOS keychain (`src/native-auth.ts`).
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs"
import { Option } from "effect"
import {
	makeElementBridge,
	makeRuneTarget,
	stdioTransport,
	StyleResolver,
	type HostToRuntime,
} from "@hazel/foldkit-rune"
import { isBackendUrl } from "./backend-origin"
import { describeLink, makeDesktopBridge } from "./desktop-bridge"
import { usesKeychainSession } from "./native-auth"
import { type EditableEvent, makePendingEdits } from "./pending-edits"
import { nativeOverlays, pathOf } from "./overlay"
import { overlayPlugin } from "./overlay-plugin"
import { installShims, openExternal } from "./shims"

// Before any app module loads: its overlay helpers become the host-drawn ones.
Bun.plugin(overlayPlugin)

const width = Number(process.env.NATIVE_WIDTH ?? 1280)
const height = Number(process.env.NATIVE_HEIGHT ?? 800)
const dark = process.env.NATIVE_THEME === "dark"
const dataMode = process.env.HAZEL_DATA === "live" ? "live" : "offline"
const statsPath = process.env.NATIVE_STATS

// A production build, as the web app ships and the desktop bundle is: dev-only pages (the debug
// settings) redirect. `HAZEL_DEV=1` keeps the dev build. Under Bun, `import.meta.env` is `process.env`.
if (process.env.HAZEL_DEV !== "1") process.env.PROD = "true"
if (dataMode === "offline") process.env.VITE_BACKEND_URL = "http://offline.hazel.test"
const backendUrl = process.env.VITE_BACKEND_URL ?? "http://localhost:3003"

// Live mode opens the app's own landing route; the fixture's channel exists only offline.
const offline = dataMode === "offline" ? await import("./offline-session") : undefined
const startPath = process.env.NATIVE_PATH ?? offline?.startPath ?? "/"
const shims = installShims({
	width,
	height,
	dark,
	url: `http://app.hazel.test${startPath}`,
	// Live, a full page load (after sign-in or sign-out) boots a fresh runtime, as a browser does.
	loadDocument:
		dataMode === "live"
			? (href) => {
					const next = new URL(href)
					transport.send({ t: "reload", path: `${next.pathname}${next.search}${next.hash}` })
				}
			: undefined,
})

// A browser reports an uncaught error and keeps the page running; one stray error in a timer
// must not end the runtime and leave the window unresponsive.
const reportUncaught = (kind: string) => (error: unknown) => {
	const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
	process.stderr.write(`[uncaught ${kind}] ${detail}\n`)
}
process.on("uncaughtException", reportUncaught("error"))
process.on("unhandledRejection", reportUncaught("rejection"))
// The host asks the runtime to stop with SIGTERM: exit normally, so exit work (a CPU profile) runs.
process.on("SIGTERM", () => process.exit(0))

/** The Tauri APIs the app's browser sign-in uses, answered by the host (keychain, opened links). */
const desktopBridge = makeDesktopBridge({
	send: (request) => transport.send(request),
	// The host sets this for a release bundle it can update in place.
	updates: process.env.HAZEL_UPDATES === "1",
	openUrl: (url) => {
		const target = URL.parse(url)
		if (target !== null) openExternal(target)
	},
})

// The Tauri APIs the host answers: for the keychain sign-in, and for updates where it offers them.
if (usesKeychainSession || process.env.HAZEL_UPDATES === "1")
	Object.assign(window, { __TAURI__: desktopBridge.tauri })

if (offline !== undefined) {
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
			// Only the frame's kind and size: frames carry access tokens and message text.
			const tag = /"_tag":"([A-Za-z]+)"/.exec(data)?.[1] ?? "frame"
			process.stderr.write(`[offline] ws> ${tag} (${data.length} bytes)\n`)
			super.send(data)
		}
	}
	Object.assign(globalThis, { WebSocket: process.env.NATIVE_DEBUG ? DebugWebSocket : FixtureWebSocket })
} else if (usesKeychainSession) {
	if (URL.parse(backendUrl) === null)
		throw new Error(`HAZEL_DATA=live needs a backend URL, got "${backendUrl}"`)
	const { setSessionBearerProvider } = await import("../../web-foldkit/src/core/lib/session-bearer")
	const { desktopSessionBearer } = await import("../../web-foldkit/src/platform/desktop-auth")
	setSessionBearerProvider(desktopSessionBearer)
} else {
	const token = process.env.HAZEL_SESSION_TOKEN ?? ""
	if (URL.parse(backendUrl) === null)
		throw new Error(`HAZEL_DATA=live needs a backend URL, got "${backendUrl}"`)
	const { setSessionBearerProvider } = await import("../../web-foldkit/src/core/lib/session-bearer")
	setSessionBearerProvider(() => Promise.resolve(token))
	const networkFetch = globalThis.fetch
	globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
		const request = new Request(input, init)
		if (isBackendUrl(request.url, backendUrl)) request.headers.set("authorization", `Bearer ${token}`)
		return networkFetch(request)
	}
}

const { Layer } = await import("effect")
const { Runtime } = await import("foldkit")
const app = await import("../../web-foldkit/src/main")
// The editor root's class: the composer field takes its padding, text size and minimum height.
const { EDITABLE_CLASS } = await import("../../web-foldkit/src/editor/editor-view")
const { ResourcesLive } = await import("../../web-foldkit/src/rpc")
const { NotificationSinks } = await import("../../web-foldkit/src/app/notification-sinks")
const PendingAnnouncement = await import("../../web-foldkit/src/ui/aria/pending-announcement")

const stylesheet = new URL("../../web-foldkit/src/styles.css", import.meta.url).pathname
// The bundled runtime ships its sheet compiled (`bun run build`); from source it compiles here.
const precompiledPath = process.env.HAZEL_NATIVE_STYLES ?? new URL("./styles.json", import.meta.url).pathname
const styles = existsSync(precompiledPath)
	? StyleResolver.fromPrecompiled(JSON.parse(readFileSync(precompiledPath, "utf8")), stylesheet)
	: await StyleResolver.load(stylesheet)

/** A press on an `href` replays as the click Foldkit's link listener expects on `document`. */
const followLink = (href: string) => {
	if (process.env.NATIVE_DEBUG) process.stderr.write(`[link] ${href}\n`)
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

/** The overlay Mounts run on proxies too: their helpers ask the host for the overlay itself. */
const OVERLAY_MOUNTS = [
	"PortalMenu",
	"PortalSelect",
	"PortalComboBox",
	"PortalDatePicker",
	"PortalPickerPopover",
	"PortalCommandMenu",
	"PositionSubmenu",
	"AnchorTooltipPanel",
	// @foldkit/ui's, through the native anchor module.
	"AnchorPopover",
	"PortalPopoverBackdrop",
	"AnchorMenu",
	"PortalMenuBackdrop",
	"AnchorListbox",
	"PortalListboxBackdrop",
	"AnchorCombobox",
	"PortalComboboxBackdrop",
	"AnchorTooltip",
	// A Dialog shows itself (`Dom.showDialog`, which the render target answers) when it mounts.
	"AcquireResources",
]

/**
 * Mounts that only ask the host to act on their element (focus it, reveal it): they run when
 * they mount, as a hidden marker never gets a layout of its own.
 */
const SCRIPT_MOUNTS = [
	// The open channel's sidebar row scrolls into view (`closest('[role="row"]')`).
	"ScrollActiveIntoView",
	// React's `autoFocus`.
	"AutoFocusMemberSearch",
	"AutoFocusOnboardingInput",
]

/**
 * Mounts that listen for delegated pointer events (hover, right-click) on their element, with the
 * selector of the elements they look for: the message list's hover shows a message's toolbar.
 */
const POINTER_MOUNTS = new Map([
	["TrackMessageHover", "[data-id]"],
	// The message toolbar: its own element only (an empty selector matches nothing below it).
	["PlaceMessageToolbar", ""],
	// A context menu trigger hears right-clicks on itself.
	["CaptureContextMenu", ""],
])

/** Mounts that only observe geometry run against host-backed element proxies; the editor gets a headless DOM. */
const bridge = makeElementBridge({
	mounts: new Set(["ObserveMessageList", ...OVERLAY_MOUNTS, ...SCRIPT_MOUNTS, ...POINTER_MOUNTS.keys()]),
	immediateMounts: new Set([...OVERLAY_MOUNTS, ...SCRIPT_MOUNTS, ...POINTER_MOUNTS.keys()]),
	pointerTargets: POINTER_MOUNTS,
	domMounts: new Map([["MountEditor", composer.makeEditorElement]]),
	send: (command) => transport.send(command),
	onObserve: () => rune.refreshObserved(),
	// The message toolbar places itself on its message (`element.style.top`, `left`, `visibility`).
	styledMounts: new Set(["PlaceMessageToolbar"]),
	onRestyle: () => rune.refreshObserved(),
	onScroll: () => shims.dispatchElementScroll(),
	// `rune` is created below; a Mount clicks only after the first commit.
	onClick: (path) => rune.click(path),
	onRemove: (path) => {
		bodyPortals.get(path)?.()
		bodyPortals.delete(path)
	},
})
Object.assign(globalThis, {
	ResizeObserver: bridge.ResizeObserver,
	MutationObserver: bridge.MutationObserver,
})
// SAFETY: the app only reads the geometry ProxyElement implements from `getElementById` results.
document.getElementById = (id: string) => bridge.findById(id) as unknown as HTMLElement | null
// A Mount moving its element into `<body>` (the message toolbar) portals it; `remove()` undoes it.
const bodyPortals = new Map<string, () => void>()
Object.assign(document.body, {
	appendChild: <T>(child: T): T => {
		const path = pathOf(child)
		if (path !== undefined && !bodyPortals.has(path)) bodyPortals.set(path, nativeOverlays.portal(path))
		return child
	},
})

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
/** Theme tokens read through `getComputedStyle` (the HTML render theme) come from the stylesheet. */
Object.assign(globalThis, {
	getComputedStyle: (element?: unknown) => ({
		getPropertyValue: (name: string) =>
			name.startsWith("--") ? styles.customProperty(name, rune.env.dark) : "",
		// The message toolbar looks for its message's scroller.
		overflowY: bridge.overflowYOf(element),
	}),
})

/** Applies a native field's edit to its editor; `false` while the editor has not mounted yet. */
const applyEdit = (path: string, event: EditableEvent) => {
	const mount = bridge.domMountAt(path)
	if (mount === undefined) return false
	return Option.match(composer.applyEditorEvent(mount.args, event), {
		onNone: () => false,
		onSome: (isChangedByKey) => {
			// A key the editor handled (undo, a markdown shortcut) changed the text under the field.
			if (isChangedByKey) rune.refreshObserved()
			return true
		},
	})
}
const pendingEdits = makePendingEdits({ apply: applyEdit, onDrained: () => rune.refreshObserved() })

const rune = makeRuneTarget({
	styles,
	overlays: nativeOverlays,
	bridge,
	// A field with edits still queued keeps the text the user typed, not the empty editor's.
	editableText: (path) => {
		const queued = pendingEdits.queuedText(path)
		if (queued !== undefined) return queued
		const mount = bridge.domMountAt(path)
		return mount === undefined ? undefined : composer.editorText(mount.args)
	},
	onLink: followLink,
	// The editor root's own classes; ProseMirror's state classes on it carry no layout.
	editableClass: () => EDITABLE_CLASS,

	onEditable: (path, event) => {
		// The text's length, not the text: the debug log must not hold what the user typed.
		if (process.env.NATIVE_DEBUG)
			process.stderr.write(`[editable] key=${event.key ?? "-"} chars=${event.value?.length ?? "-"}\n`)
		pendingEdits.push(path, event)
	},

	env: { width, height, dark },
	send: (message) => {
		if (treesPath) appendFileSync(treesPath, `${JSON.stringify(message)}\n`)
		return transport.send(message)
	},
	onStats: (stats) => {
		scheduleHeadlessDom()
		if (statsPath) {
			const heapUsedMb = process.memoryUsage().heapUsed / 1048576
			appendFileSync(statsPath, `${JSON.stringify({ at: performance.now(), heapUsedMb, ...stats })}\n`)
		}
	},
})

// The theme customization lands on `<html>`'s inline style: restyle what is on screen with it.
styles.setRootProperties(shims.rootStyle)
shims.onRootStyle(() => {
	styles.setRootProperties(shims.rootStyle)
	rune.refreshObserved()
})

// Created last: the host writes as soon as it starts, and every handler below must exist by then.
const transport = stdioTransport((message: HostToRuntime) => {
	if (message.t === "env")
		shims.updateEnv({ width: message.width, height: message.height, dark: message.dark })
	if (message.t === "openUrl") {
		process.stderr.write(`[native] opened with ${describeLink(message.url)}\n`)
		desktopBridge.openedUrl(message.url)
		return
	}
	if (message.t === "vault" || message.t === "update" || message.t === "updateProgress") {
		desktopBridge.answer(message)
		return
	}
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
