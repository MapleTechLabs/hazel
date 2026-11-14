/**
 * The iOS platform: the runtime runs in a Web Worker inside a hidden `WKWebView` (every web API,
 * WebKit's JIT), and its page relays between the worker and the Rune host (`host/ios`). Protocol
 * messages cross as JSON lines (strings); the platform's own requests as objects.
 */
import { nativeClient, nativeHeaders } from "@hazel/auth/contract"
import type { PrecompiledStyles } from "@hazel/foldkit-rune"
import { parseHostLine } from "@hazel/foldkit-rune"
import { PUSH_DEVICE_GLOBAL, type PushDevice } from "../../web-foldkit/src/platform/push-device"
import { SYSTEM_UI_GLOBAL, type SystemUi } from "../../web-foldkit/src/platform/system-ui"
import { readConfig } from "./config"
import { type CacheRequest, makeIosLocalCache } from "./local-cache-ios"
import type { NativePlatform } from "./platform"
import { isAppPath, makePushDevice, type PushToken } from "./push"

/** What the page set before this worker's source: the host's environment. */
declare const __HAZEL_ENV__: Record<string, string>
/** `localStorage`'s entries as the host saved them last, set with the environment; `null` before the first save. */
declare const __HAZEL_STORAGE__: Record<string, string> | null
/** The stylesheet compiled for every class the app's sources use (`scripts/build-ios.ts`). */
declare const __HAZEL_STYLES__: PrecompiledStyles

/** A request to the host that is not render protocol. */
export type IosRequest =
	| { readonly log: string }
	| { readonly open: string }
	| { readonly copy: string }
	| { readonly signIn: string; readonly callbackScheme: string }
	/** A request the host sends for the worker (`host/ios/src/http.rs`), as JSON. */
	| { readonly fetch: string }
	/**
	 * The page is about to move (`host/ios/src/system.rs`), as JSON `{ from, to, back }` (paths):
	 * the host takes a picture of the page it leaves. `back`: to where the back chevron leads.
	 */
	| { readonly navigate: string }
	/** A tap of the finger (`host/ios/src/system.rs`). */
	| { readonly haptic: true }
	/** Where the edge swipe goes back to; empty turns the swipe off. */
	| { readonly swipeBack: string }
	/** The runtime followed a notification's path (`openPath`): the host stops holding it. */
	| { readonly openedPath: string }
	/** `localStorage`'s entries to save (`host/ios/src/storage.rs`), as JSON. */
	| { readonly storage: string }
	/** A statement for the local cache's SQLite (`host/ios/src/local_cache.rs`), as JSON with its `id`. */
	| { readonly cache: string }

/** The host's answer to a `fetch` request. */
type FetchReply =
	| { readonly id: number; readonly error: string }
	| {
			readonly id: number
			readonly status: number
			readonly headers: Record<string, string>
			readonly body: string
	  }

/** The scheme of the link sign-in hands back to the native app (`com.hazel.native`). */
const CALLBACK_SCHEME = new URL(nativeClient.returnUrl).protocol.slice(0, -1)

// Captured before the shims put the window they fake over the worker's globals.
const post = globalThis.postMessage.bind(globalThis)
const request = (message: IosRequest) => post(message)
const early: Array<string> = []
let deliver: ((line: string) => void) | undefined
/** The host's answer to a `cache` request: the reply's JSON text, parsed here. */
type CacheReply = { readonly id: number; readonly cache: string }
/** Requests waiting on the host, by the id each went out with. */
const replies = new Map<number, (reply: FetchReply | CacheReply) => void>()
let nextRequest = 0
/** The edge swipe went back. */
type BackReply = { readonly back: true }
/** A notification's tap opens the app at this path (`host/ios/src/push.rs`). */
type OpenPathReply = { readonly openPath: string }
/** What the host hands the worker that is not a line or a fetch's answer. */
type HostReply = BackReply | PushToken | OpenPathReply
/** What waits for the runtime to start: the push token, a notification's path. */
const afterStart: Array<() => void> = []
let isRuntimeStarted = false
const whenStarted = (run: () => void) => (isRuntimeStarted ? run() : afterStart.push(run))
/** Set below, once `log` exists. */
let push: ReturnType<typeof makePushDevice> | undefined
/** The back chevrons on screen, latest last: the swipe goes where the latest leads. */
const backTargets: Array<{ readonly href: string }> = []
/** A URL's path, query and hash: what the host keys its pictures of pages by. */
const pathOf = (href: string) => {
	const url = new URL(href, globalThis.location.href)
	return `${url.pathname}${url.search}${url.hash}`
}
const goBack = () => {
	const target = backTargets.at(-1)
	if (target === undefined) return
	// The runtime's link handling, as a tap on the chevron would follow it.
	void import("./document-bridge").then(({ followLink }) => followLink(target.href))
}
const isHostReply = (data: FetchReply | CacheReply | HostReply): data is HostReply => !("id" in data)
/** Follows a notification's path, one of the app's own only (the host checks it too). */
const openPath = (path: string) => {
	if (!isAppPath(path, globalThis.location.href)) {
		log(`[push] not opening a path that leaves the app: ${JSON.stringify(path)}`)
		return request({ openedPath: path })
	}
	log(`[push] opening ${path}`)
	// The host holds the path until it is followed: a page that ends first restarts at it.
	void import("./document-bridge").then(({ followLink }) => {
		followLink(path)
		request({ openedPath: path })
	})
}
const hostReply = (reply: HostReply) => {
	if ("back" in reply) goBack()
	else if ("pushToken" in reply) whenStarted(() => void push?.register(reply))
	else if ("openPath" in reply) whenStarted(() => openPath(reply.openPath))
}
globalThis.onmessage = (event: MessageEvent<string | FetchReply | CacheReply | HostReply>) => {
	const data = event.data
	if (typeof data !== "string" && isHostReply(data)) hostReply(data)
	else if (typeof data !== "string") {
		replies.get(data.id)?.(data)
		replies.delete(data.id)
	} else {
		// A batch of host lines (one frame's reports), split here so they run in one task.
		for (const line of data.split("\n")) {
			if (line === "") continue
			if (deliver === undefined) early.push(line)
			else deliver(line)
		}
	}
}

/**
 * The app's requests as the native app (`x-auth-mode: native`: sign-in, the session) go out
 * through the host: the API admits them only without `Origin`, `Sec-Fetch-Mode` and cookies,
 * which WebKit puts on every fetch from here. Everything else is the page's own fetch.
 */
const webFetch = globalThis.fetch.bind(globalThis)
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
	const outgoing = new Request(input, init)
	if (outgoing.headers.get(nativeHeaders.modeHeader) !== "native") return webFetch(outgoing)
	const id = ++nextRequest
	const body = ["GET", "HEAD"].includes(outgoing.method) ? undefined : await outgoing.text()
	const reply = await new Promise<FetchReply | CacheReply>((resolve, reject) => {
		replies.set(id, resolve)
		outgoing.signal.addEventListener("abort", () => {
			replies.delete(id)
			reject(outgoing.signal.reason)
		})
		const headers = Object.fromEntries(outgoing.headers)
		request({ fetch: JSON.stringify({ id, url: outgoing.url, method: outgoing.method, headers, body }) })
	})
	if ("cache" in reply) throw new TypeError("Load failed: not a fetch reply")
	if ("error" in reply) throw new TypeError(`Load failed: ${reply.error}`)
	const empty = [101, 204, 205, 304].includes(reply.status)
	return new Response(empty ? null : reply.body, { status: reply.status, headers: reply.headers })
}

// The runtime and the web app read their settings from `process.env`, as under Bun.
Object.assign(globalThis, { process: { env: { ...__HAZEL_ENV__ }, platform: "ios" } })
const log = (line: string) => request({ log: line })
for (const name of ["log", "info", "debug", "warn", "error"] as const)
	console[name] = (...parts: Array<unknown>) => log(parts.map(String).join(" "))
/** An error's name, message and stack: WebKit's `stack` holds the frames alone. */
const describe = (error: unknown) =>
	error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error)
// Handled here, with its stack: the page's `worker.onerror` then hears only load failures.
globalThis.addEventListener("error", (event) => {
	event.preventDefault()
	log(`[uncaught error] ${describe(event.error ?? event.message)}`)
})
globalThis.addEventListener("unhandledrejection", (event) =>
	log(`[uncaught rejection] ${describe(event.reason)}`),
)

/** One local cache request to the host; answers with its reply's text. */
const askCache = (cacheRequest: CacheRequest) =>
	new Promise<string>((resolve, reject) => {
		const id = ++nextRequest
		replies.set(id, (reply) =>
			"cache" in reply ? resolve(reply.cache) : reject(new Error("not a local cache reply")),
		)
		request({ cache: JSON.stringify({ id, ...cacheRequest }) })
	})

const platform: NativePlatform = {
	connect: (onMessage) => {
		// As the Bun platform's transport reads them: a malformed line is reported and skipped.
		deliver = (line) => {
			const parsed = parseHostLine(line)
			if ("message" in parsed) onMessage(parsed.message)
			else log(`[native] bad host line: ${parsed.error}`)
		}
		for (const line of early.splice(0)) deliver(line)
		return {
			send: (message) => {
				const line = JSON.stringify(message)
				post(line)
				return line.length
			},
		}
	},
	log,
	// The app's own browser sign-in (`/auth/desktop` on the web app's origin, which the page
	// has) shows in the system's sign-in sheet, which hands its callback back
	// (`com.hazel.native://auth/callback`); every other link opens in the browser.
	openUrl: (href) => {
		const target = URL.parse(href)
		const isSignIn = target?.pathname === "/auth/desktop" && target.origin === globalThis.location.origin
		request(isSignIn ? { signIn: href, callbackScheme: CALLBACK_SCHEME } : { open: href })
	},
	copyText: (text) => request({ copy: text }),
	// The host keeps the file, and hands every page it loads the entries it checked.
	storage: {
		load: () => __HAZEL_STORAGE__ ?? undefined,
		save: (entries) => request({ storage: JSON.stringify(entries) }),
	},
	localCache: ({ persist }) => makeIosLocalCache({ persist, send: askCache }),
	// No files from the worker: debug lines (`NATIVE_STATS`) go to the log, tagged with their file.
	appendLine: (path, line) => log(`[${path}] ${line}`),
	onNavigate: (from, to) => {
		const back = backTargets.at(-1)
		const isBack = back !== undefined && pathOf(back.href) === pathOf(to)
		request({ navigate: JSON.stringify({ from: pathOf(from), to: pathOf(to), back: isBack }) })
	},
	// The bundle carries the sheet compiled for every class the app's sources use.
	loadStyles: async () => {
		const { StyleResolver } = await import("@hazel/foldkit-rune")
		return StyleResolver.fromPrecompiled(__HAZEL_STYLES__, "styles.css")
	},
}

const systemUi: SystemUi = {
	haptic: () => request({ haptic: true }),
	setSwipeBack: (href) => {
		const target = { href }
		backTargets.push(target)
		request({ swipeBack: pathOf(href) })
		return () => {
			const index = backTargets.indexOf(target)
			if (index !== -1) backTargets.splice(index, 1)
			const back = backTargets.at(-1)
			request({ swipeBack: back === undefined ? "" : pathOf(back.href) })
		}
	},
}

push = makePushDevice({ config: readConfig(process.env), log })
const pushDevice: PushDevice = { unregister: () => push?.unregister() ?? Promise.resolve() }

// Read by the app (`platform/system-ui.ts`, `platform/push-device.ts`), as the desktop shells
// install `window.__TAURI__`.
Object.assign(globalThis, { [SYSTEM_UI_GLOBAL]: systemUi, [PUSH_DEVICE_GLOBAL]: pushDevice })

const { startRuntime } = await import("./runtime")
await startRuntime(platform)
isRuntimeStarted = true
for (const run of afterStart.splice(0)) run()
