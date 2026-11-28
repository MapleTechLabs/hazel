/**
 * The page's side of the native app's web fallback (`Hazel/FallbackPage.swift`): a route with no
 * native screen yet is the web app in a web view, pushed like any screen. The page forwards its
 * console, sends its pictures from fussy hosts through the app, hides its own tab bar (the app's
 * are native), and reports where it went, so a link opens as a screen of its own.
 */

type ShellMessage =
	/** `replaced`: where the page landed or a redirect put it (`history.replaceState`), not a link. */
	{ type: "location"; text: string; replaced: boolean } | { type: "log"; level: string; text: string }

/** A command for the app (`web/host.ts`): its name and arguments. */
export type HostRequest = { command: string; args: Record<string, unknown> }
/** The app's answer: `{ value }`, or `{ error }` when the command failed. */
export type HostAnswer = { value?: unknown; error?: string }

type Webkit = {
	messageHandlers?: {
		hazel?: { postMessage: (message: ShellMessage) => void }
		/** Asks the app and answers (`HostBridge.swift`, `web/host.ts`). */
		host?: { postMessage: (body: HostRequest) => Promise<HostAnswer> }
	}
}

declare global {
	interface Window {
		/** WebKit's script message handlers, in a `WKWebView` (the app's `FallbackPage`). */
		webkit?: Webkit
	}
}

const post = (message: ShellMessage) => window.webkit?.messageHandlers?.hazel?.postMessage(message)

/** Whether the page runs in the app's web view; a browser (the offline build opened on a Mac) has none. */
export const inShell = () => window.webkit?.messageHandlers?.hazel !== undefined

/** The web's phone tab bar (`web-foldkit/src/shell/mobile.ts`): the app draws its own. */
const TAB_BAR = '[data-native="tab-bar"]'

export const forwardConsole = () => {
	const text = (args: ReadonlyArray<unknown>) =>
		args
			.map((arg) =>
				arg instanceof Error
					? `${arg.name}: ${arg.message}\n${arg.stack}`
					: typeof arg === "string"
						? arg
						: safeJson(arg),
			)
			.join(" ")
	for (const level of ["log", "info", "warn", "error"] as const) {
		const original = console[level].bind(console)
		console[level] = (...args: Array<unknown>) => {
			original(...args)
			post({ type: "log", level, text: text(args) })
		}
	}
	addEventListener("error", (event) =>
		post({ type: "log", level: "error", text: `${event.message} at ${event.filename}:${event.lineno}` }),
	)
	// A picture that failed to load (its error does not bubble: caught on the way down).
	addEventListener(
		"error",
		(event) => {
			if (event.target instanceof HTMLImageElement)
				post({ type: "log", level: "warn", text: `[image] failed ${event.target.currentSrc}` })
		},
		true,
	)
	addEventListener("unhandledrejection", (event) =>
		post({ type: "log", level: "error", text: `unhandled: ${text([event.reason])}` }),
	)
}

const safeJson = (value: unknown) => {
	try {
		return JSON.stringify(value)
	} catch {
		return String(value)
	}
}

/**
 * Hosts that serve pictures only to web apps they know (Brandfetch's logo CDN refuses a page with no
 * web origin, as `hazel://app` is): their pictures go through the shell, which fetches them as the
 * web app (`RemotePicture` in `SchemeHandler.swift`).
 */
const PROXIED_HOSTS = new Set(["cdn.brandfetch.io"])

const proxyPicture = (image: HTMLImageElement) => {
	const src = image.getAttribute("src")
	if (src === null || !src.startsWith("https://")) return
	if (PROXIED_HOSTS.has(new URL(src).host))
		image.setAttribute("src", `hazel://app/__remote?u=${encodeURIComponent(src)}`)
}

const proxyPictures = () => {
	// A page on the web app's origin sends its own referrer: those hosts serve it as they are.
	if (location.protocol === "https:") return
	for (const image of Array.from(document.images)) proxyPicture(image)
	new MutationObserver((records) => {
		for (const record of records) {
			if (record.type === "attributes" && record.target instanceof HTMLImageElement)
				proxyPicture(record.target)
			for (const node of Array.from(record.addedNodes)) {
				if (node instanceof HTMLImageElement) proxyPicture(node)
				else if (node instanceof Element) node.querySelectorAll("img").forEach(proxyPicture)
			}
		}
	}).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] })
}

/** Where the page is: each new path once, with whether a redirect put it there. */
const reportLocation = () => {
	let last = ""
	// The path a redirect last put in place: the page is still the same screen.
	let replacedTo: string | null = null
	const replaceState = history.replaceState.bind(history)
	history.replaceState = (data: unknown, unused: string, url?: string | URL | null) => {
		replaceState(data, unused, url)
		replacedTo = location.pathname
		report()
	}
	const report = () => {
		if (location.pathname === last) return
		// The first report is where the page landed (a redirect at start included), not a link.
		const replaced = last === "" || replacedTo === location.pathname
		last = location.pathname
		post({ type: "location", text: location.pathname, replaced })
	}
	const pushState = history.pushState.bind(history)
	history.pushState = (data: unknown, unused: string, url?: string | URL | null) => {
		pushState(data, unused, url)
		report()
	}
	addEventListener("popstate", report)
	report()
}

export const installBridge = () => {
	proxyPictures()
	const style = document.createElement("style")
	style.textContent = `${TAB_BAR} { display: none !important; }
		* { -webkit-tap-highlight-color: transparent; -webkit-touch-callout: none; }`
	document.head.appendChild(style)
	reportLocation()
}
