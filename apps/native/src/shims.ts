import { spawn } from "node:child_process"

/**
 * The browser surface Hazel's app touches outside rendering, for a Bun process with no DOM:
 * window and document as event targets, an in-memory history, storage, matchMedia, and the
 * observers and media classes some modules construct. Import before the app.
 */
export type ShimEnv = {
	width: number
	height: number
	dark: boolean
	url: string
	/** Opens a link outside the app. @default the system browser or mail app */
	openUrl?: (href: string) => void
}

class MemoryStorage {
	private items = new Map<string, string>()
	get length() {
		return this.items.size
	}
	key(index: number) {
		return [...this.items.keys()][index] ?? null
	}
	getItem(key: string) {
		return this.items.get(key) ?? null
	}
	setItem(key: string, value: string) {
		this.items.set(key, String(value))
	}
	removeItem(key: string) {
		this.items.delete(key)
	}
	clear() {
		this.items.clear()
	}
}

class InertObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return []
	}
}

class SilentAudio extends EventTarget {
	volume = 1
	currentTime = 0
	src = ""
	preload = "auto"
	play() {
		return Promise.resolve()
	}
	pause() {}
	load() {}
}

/** Present so `instanceof Element` checks answer false instead of throwing. */
class DomNode extends EventTarget {}

/** An idle callback's budget, as a browser gives one between frames. */
const IDLE_SLICE_MS = 50

/** Any element whose tag is `dialog` (a host-backed proxy): foldkit's Dialog checks for one. */
class ShimDialogElement extends DomNode {
	static [Symbol.hasInstance](value: unknown): boolean {
		return value instanceof DomNode && "tagName" in value && value.tagName === "DIALOG"
	}
}

/** The fields of a mouse event the app reads from pointer events the bridge dispatches. */
class ShimMouseEvent extends Event {
	readonly button: number
	readonly clientX: number
	readonly clientY: number
	readonly relatedTarget: EventTarget | null
	constructor(
		type: string,
		init: EventInit & {
			button?: number
			clientX?: number
			clientY?: number
			relatedTarget?: EventTarget | null
		} = {},
	) {
		super(type, init)
		this.button = init.button ?? 0
		this.clientX = init.clientX ?? 0
		this.clientY = init.clientY ?? 0
		this.relatedTarget = init.relatedTarget ?? null
	}
}

/** The fields of a keyboard event the app's shortcut bindings read. */
class ShimKeyboardEvent extends Event {
	readonly key: string
	readonly code: string
	readonly shiftKey: boolean
	readonly metaKey: boolean
	readonly ctrlKey: boolean
	readonly altKey: boolean
	readonly repeat = false
	readonly isComposing = false
	constructor(type: string, init: KeyboardEventInit = {}) {
		super(type, init)
		this.key = init.key ?? ""
		this.code = init.code ?? ""
		this.shiftKey = init.shiftKey ?? false
		this.metaKey = init.metaKey ?? false
		this.ctrlKey = init.ctrlKey ?? false
		this.altKey = init.altKey ?? false
	}
	getModifierState(name: string): boolean {
		return (
			(name === "Shift" && this.shiftKey) ||
			(name === "Meta" && this.metaKey) ||
			(name === "Control" && this.ctrlKey) ||
			(name === "Alt" && this.altKey)
		)
	}
}

class ShimPointerEvent extends ShimMouseEvent {
	readonly pointerType = "mouse"
}

const classList = () => {
	const names = new Set<string>()
	return {
		add: (...tokens: Array<string>) => tokens.forEach((t) => names.add(t)),
		remove: (...tokens: Array<string>) => tokens.forEach((t) => names.delete(t)),
		toggle: (token: string, force?: boolean) => {
			const isOn = force ?? !names.has(token)
			if (isOn) names.add(token)
			else names.delete(token)
			return isOn
		},
		contains: (token: string) => names.has(token),
	}
}

const element = () => {
	// Detached nodes (a live-region announcer) build and move freely; nothing draws them.
	const childNodes: Array<unknown> = []
	return Object.assign(new DomNode(), {
		childNodes,
		classList: classList(),
		style: { setProperty() {}, removeProperty() {} },
		dataset: {} as Record<string, string>,
		setAttribute() {},
		removeAttribute() {},
		getAttribute: () => null,
		appendChild: <T>(child: T) => child,
		removeChild: <T>(child: T) => child,
		insertBefore: <T>(child: T) => child,
		append: (...nodes: Array<unknown>) => {
			childNodes.push(...nodes)
		},
		prepend: (...nodes: Array<unknown>) => {
			childNodes.unshift(...nodes)
		},
		remove() {},
		querySelector: () => null,
		querySelectorAll: () => [],
		getElementsByTagName: () => [],
		contains: () => false,
		getBoundingClientRect: () => ({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 0,
			bottom: 0,
			width: 0,
			height: 0,
		}),
	})
}

/** `CSS.escape` (CSS Object Model): an identifier safe to put in a selector. */
export const cssEscape = (value: string): string => {
	let out = ""
	for (let i = 0; i < value.length; i++) {
		const code = value.charCodeAt(i)
		const ch = value.charAt(i)
		const isDigit = code >= 0x30 && code <= 0x39
		if (code === 0) out += "\uFFFD"
		else if ((code >= 0x01 && code <= 0x1f) || code === 0x7f) out += `\\${code.toString(16)} `
		else if (isDigit && (i === 0 || (i === 1 && value.charAt(0) === "-")))
			out += `\\${code.toString(16)} `
		else if (i === 0 && ch === "-" && value.length === 1) out += "\\-"
		else if (code >= 0x80 || ch === "-" || ch === "_" || isDigit || /[a-zA-Z]/.test(ch)) out += ch
		else out += `\\${ch}`
	}
	return out
}

export const installShims = (env: ShimEnv) => {
	// stdout carries the render protocol; logs go to stderr.
	console.log = console.error
	console.info = console.error
	console.debug = console.error
	const g = globalThis as Record<string, unknown>
	g.CSS ??= { escape: cssEscape, supports: () => false }
	const windowTarget = new EventTarget()
	let url = new URL(env.url)
	const entries: Array<string> = [url.href]
	let index = 0

	const location = {
		get href() {
			return url.href
		},
		get origin() {
			return url.origin
		},
		get pathname() {
			return url.pathname
		},
		get search() {
			return url.search
		},
		get hash() {
			return url.hash
		},
		get host() {
			return url.host
		},
		get protocol() {
			return url.protocol
		},
		set href(next: string) {
			navigate(next, "push")
		},
		assign: (next: string) => navigate(next, "push"),
		replace: (next: string) => navigate(next, "replace"),
		reload: () => {},
	}
	/** In-app paths move the in-memory history; another origin opens in the system browser. */
	const navigate = (next: string | URL, mode: "push" | "replace") => {
		const target = URL.parse(String(next), url)
		if (target !== null && target.origin !== url.origin) return openExternal(target, env.openUrl)
		if (mode === "push") history.pushState(null, "", next)
		else history.replaceState(null, "", next)
	}
	const navigateTo = (next: number) => {
		index = Math.max(0, Math.min(entries.length - 1, next))
		url = new URL(entries[index] ?? url.href)
		windowTarget.dispatchEvent(Object.assign(new Event("popstate"), { state: null }))
	}
	const history = {
		// SAFETY: history state is opaque app data, as `History.state` is in a browser.
		state: null as unknown,
		get length() {
			return entries.length
		},
		pushState: (state: unknown, _title: string, next?: string | URL | null) => {
			url = new URL(String(next ?? url.href), url)
			entries.splice(index + 1, entries.length, url.href)
			index = entries.length - 1
			history.state = state
		},
		replaceState: (state: unknown, _title: string, next?: string | URL | null) => {
			url = new URL(String(next ?? url.href), url)
			entries[index] = url.href
			history.state = state
		},
		back: () => navigateTo(index - 1),
		forward: () => navigateTo(index + 1),
		go: (delta = 0) => navigateTo(index + delta),
	}

	const evaluateQuery = (query: string): boolean => {
		if (/prefers-color-scheme:\s*dark/.test(query)) return env.dark
		if (/prefers-color-scheme:\s*light/.test(query)) return !env.dark
		if (/prefers-reduced-motion:\s*reduce/.test(query)) return false
		const max = /max-width:\s*([\d.]+)px/.exec(query)
		if (max) return env.width <= Number(max[1])
		const min = /min-width:\s*([\d.]+)px/.exec(query)
		if (min) return env.width >= Number(min[1])
		return false
	}
	const queries = new Set<EventTarget & { media: string; matches: boolean }>()
	const matchMedia = (media: string) => {
		const list = Object.assign(new EventTarget(), {
			media,
			matches: evaluateQuery(media),
			onchange: null,
			addListener: (fn: EventListener) => list.addEventListener("change", fn),
			removeListener: (fn: EventListener) => list.removeEventListener("change", fn),
		})
		queries.add(list)
		return list
	}

	// The app themes itself through `<html>`'s inline custom properties (brand colour, radius).
	const rootStyle = new Map<string, string>()
	const rootStyleListeners = new Set<() => void>()
	const changedRootStyle = () => rootStyleListeners.forEach((listener) => listener())
	const documentElement = Object.assign(element(), {
		style: {
			setProperty: (name: string, value: string) => {
				if (rootStyle.get(name) === value) return
				rootStyle.set(name, value)
				changedRootStyle()
			},
			removeProperty: (name: string) => {
				if (rootStyle.delete(name)) changedRootStyle()
			},
			getPropertyValue: (name: string) => rootStyle.get(name) ?? "",
		},
	})
	const document = Object.assign(new DomNode(), {
		documentElement,
		body: element(),
		head: element(),
		title: "",
		visibilityState: "visible",
		hidden: false,
		readyState: "complete",
		hasFocus: () => true,
		createElement: () => element(),
		createElementNS: () => element(),
		createTextNode: () => element(),
		getElementById: () => null,
		getElementsByTagName: () => [],
		getElementsByClassName: () => [],
		querySelector: () => null,
		querySelectorAll: () => [],
		currentScript: null,
		activeElement: null,
		fonts: { ready: Promise.resolve() },
	})

	Object.assign(g, {
		window: g,
		self: g,
		top: g,
		document,
		location,
		history,
		matchMedia,
		localStorage: new MemoryStorage(),
		sessionStorage: new MemoryStorage(),
		MutationObserver: InertObserver,
		ResizeObserver: InertObserver,
		IntersectionObserver: InertObserver,
		Audio: SilentAudio,
		Node: DomNode,
		Element: DomNode,
		HTMLElement: DomNode,
		HTMLInputElement: DomNode,
		HTMLTextAreaElement: DomNode,
		HTMLDialogElement: ShimDialogElement,
		MouseEvent: ShimMouseEvent,
		PointerEvent: ShimPointerEvent,
		KeyboardEvent: ShimKeyboardEvent,
		// The host draws at the display's rate (120 Hz on ProMotion): app frames keep that pace.
		requestAnimationFrame: (callback: (time: number) => void) =>
			setTimeout(() => callback(performance.now()), 1000 / 120),
		cancelAnimationFrame: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
		// The callback gets an IdleDeadline: idle work (TanStack DB's) checks how much time it has.
		requestIdleCallback: (callback: (deadline: IdleDeadline) => void) => {
			const started = performance.now()
			const deadline = {
				didTimeout: false,
				timeRemaining: () => Math.max(0, IDLE_SLICE_MS - (performance.now() - started)),
			}
			return setTimeout(() => callback(deadline), 1)
		},
		cancelIdleCallback: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
		addEventListener: windowTarget.addEventListener.bind(windowTarget),
		removeEventListener: windowTarget.removeEventListener.bind(windowTarget),
		dispatchEvent: windowTarget.dispatchEvent.bind(windowTarget),
		innerWidth: env.width,
		innerHeight: env.height,
		devicePixelRatio: 2,
		scrollTo: () => {},
		open: (next?: string | URL) => {
			const target = next === undefined ? null : URL.parse(String(next), url)
			if (target !== null) openExternal(target, env.openUrl)
			return null
		},
		getComputedStyle: () => ({ getPropertyValue: () => "" }),
		__APP_VERSION__: "native",
	})
	Object.defineProperty(globalThis, "navigator", {
		configurable: true,
		value: {
			...globalThis.navigator,
			platform: "MacIntel",
			userAgent: "Hazel Native (Macintosh; Rune)",
			onLine: true,
			language: "en-US",
			languages: ["en-US"],
			clipboard: { writeText: async (text: string) => copyToClipboard(text) },
		},
	})

	/** The host reports window size and theme: media queries re-evaluate and notify. */
	const updateEnv = (next: Partial<ShimEnv>) => {
		Object.assign(env, next)
		Object.assign(g, { innerWidth: env.width, innerHeight: env.height })
		for (const list of queries) {
			const matches = evaluateQuery(list.media)
			if (matches === list.matches) continue
			list.matches = matches
			list.dispatchEvent(Object.assign(new Event("change"), { matches, media: list.media }))
		}
		windowTarget.dispatchEvent(new Event("resize"))
	}
	const onRootStyle = (listener: () => void) => rootStyleListeners.add(listener)
	return { updateEnv, history, location, rootStyle: rootStyle as ReadonlyMap<string, string>, onRootStyle }
}

/** Web and mail links open in the user's browser or mail app; any other scheme is dropped. */
const openExternal = (target: URL, openUrl = systemOpen) => {
	if (["http:", "https:", "mailto:"].includes(target.protocol)) openUrl(target.href)
}

const systemOpen = (href: string) => {
	const opener = spawn(process.platform === "darwin" ? "open" : "xdg-open", [href], {
		stdio: "ignore",
	})
	opener.on("error", () => {})
}

const copyToClipboard = (text: string) => {
	const copy = spawn("pbcopy", { stdio: ["pipe", "ignore", "ignore"] })
	// Without pbcopy (Linux, a stripped PATH) the copy is dropped instead of taking the runtime down.
	copy.on("error", () => {})
	copy.stdin.on("error", () => {})
	copy.stdin.end(text)
}
