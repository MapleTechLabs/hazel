import desktopApp from "../../desktop/src-tauri/tauri.conf.json" with { type: "json" }

/**
 * The browser surface Hazel's app touches outside rendering, for a runtime with no DOM:
 * window and document as event targets, an in-memory history, storage, matchMedia, and the
 * observers and media classes some modules construct. Import before the app.
 */
export type ShimEnv = {
	width: number
	height: number
	dark: boolean
	url: string
	/** Opens a web or mail link outside the app, in the system browser or mail app. */
	openUrl: (href: string) => void
	/** Puts text on the system clipboard (`navigator.clipboard.writeText`). */
	copyText: (text: string) => void
	/**
	 * A full page load on the app's own origin (`location.assign`, `reload()`), as a browser
	 * reboots the page. @default the in-memory history moves, the app keeps running
	 */
	loadDocument?: (href: string) => void
	/** Keeps `localStorage` between launches. @default it starts empty every time */
	storage?: PersistedStorage
}

/** Where `localStorage` keeps its entries between launches; absent, it lasts as long as the runtime. */
export type PersistedStorage = {
	/** The entries saved last time, if any. */
	readonly load: () => Record<string, string> | undefined
	/** Saves every entry, replacing what was saved. */
	readonly save: (entries: Record<string, string>) => void
}

/** How long writes gather before one save: the app often sets several keys in a row. */
const STORAGE_SAVE_DELAY_MS = 200

/** `Storage` in memory, saved through `persisted` (in batches, and on `flush`) when given. */
export class MemoryStorage {
	private readonly items: Map<string, string>
	private saveTimer: ReturnType<typeof setTimeout> | undefined
	constructor(private readonly persisted?: PersistedStorage) {
		this.items = new Map(Object.entries(persisted?.load() ?? {}))
	}
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
		const text = String(value)
		if (this.items.get(key) === text) return
		this.items.set(key, text)
		this.changed()
	}
	removeItem(key: string) {
		if (this.items.delete(key)) this.changed()
	}
	clear() {
		if (this.items.size === 0) return
		this.items.clear()
		this.changed()
	}
	/** Saves now what is waiting to be saved (before the runtime is replaced or quits). */
	flush() {
		if (this.saveTimer === undefined) return
		clearTimeout(this.saveTimer)
		this.saveTimer = undefined
		this.persisted?.save(Object.fromEntries(this.items))
	}
	private changed() {
		if (this.persisted === undefined || this.saveTimer !== undefined) return
		this.saveTimer = setTimeout(() => this.flush(), STORAGE_SAVE_DELAY_MS)
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

/** An element's classes; `onChange` hears every call that adds or removes one. */
const classList = (onChange?: () => void) => {
	const names = new Set<string>()
	const changing = (change: () => void) => {
		const before = [...names].join(" ")
		change()
		if (onChange !== undefined && [...names].join(" ") !== before) onChange()
	}
	return {
		add: (...tokens: Array<string>) => changing(() => tokens.forEach((t) => names.add(t))),
		remove: (...tokens: Array<string>) => changing(() => tokens.forEach((t) => names.delete(t))),
		toggle: (token: string, force?: boolean) => {
			const isOn = force ?? !names.has(token)
			changing(() => (isOn ? names.add(token) : names.delete(token)))
			return isOn
		},
		contains: (token: string) => names.has(token),
	}
}

const element = () => {
	// Detached nodes (a live-region announcer) build and move freely; nothing draws them.
	const childNodes: Array<unknown> = []
	// Kept, so what the app sets on `<html>` reads back (`hasAttribute` before a `setAttribute`).
	const attributes = new Map<string, string>()
	return Object.assign(new DomNode(), {
		childNodes,
		classList: classList(),
		style: { setProperty() {}, removeProperty() {} },
		dataset: {} as Record<string, string>,
		setAttribute: (name: string, value: unknown) => {
			attributes.set(name, String(value))
		},
		removeAttribute: (name: string) => {
			attributes.delete(name)
		},
		getAttribute: (name: string) => attributes.get(name) ?? null,
		hasAttribute: (name: string) => attributes.has(name),
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
		// No canvas drawing: a probe for a 2D context finds none, as in a browser without it.
		getContext: () => null,
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
	// `scroll` does not bubble: only a capturing listener on the window hears an element's.
	const capturedScrolls = new EventTarget()
	const targetFor = (type: string, options?: boolean | AddEventListenerOptions) =>
		type === "scroll" && (options === true || (typeof options === "object" && options.capture === true))
			? capturedScrolls
			: windowTarget
	const localStorage = new MemoryStorage(env.storage)
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
		reload: () => loadDocument(url.href),
	}
	/** A full page load ends this runtime: what it stored is saved first. */
	const loadDocument = (href: string) => {
		if (env.loadDocument === undefined) return
		localStorage.flush()
		env.loadDocument(href)
	}
	/** In-app paths move the history (or load the page anew); another origin opens in the browser. */
	const navigate = (next: string | URL, mode: "push" | "replace") => {
		const target = URL.parse(String(next), url)
		if (target !== null && target.origin !== url.origin) return openExternal(target, env.openUrl)
		if (target !== null && env.loadDocument !== undefined) return loadDocument(target.href)
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

	// The app themes itself through `<html>`'s inline custom properties (brand colour, radius)
	// and its `light`/`dark` class (the resolved theme); a change to either restyles the screen.
	const rootStyle = new Map<string, string>()
	const rootStyleListeners = new Set<() => void>()
	const changedRootStyle = () => rootStyleListeners.forEach((listener) => listener())
	const rootClasses = classList(changedRootStyle)
	const documentElement = Object.assign(element(), {
		classList: rootClasses,
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
	// Whether the window is the key window: notifications wait until it is not.
	let isWindowFocused = true
	const document = Object.assign(new DomNode(), {
		documentElement,
		body: element(),
		head: element(),
		title: "",
		visibilityState: "visible",
		hidden: false,
		readyState: "complete",
		hasFocus: () => isWindowFocused,
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

	// A worker's `self` and `location` are read-only accessors: defined, not assigned.
	for (const [name, value] of Object.entries({ self: g, location }))
		Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
	Object.assign(g, {
		window: g,
		top: g,
		document,
		history,
		matchMedia,
		localStorage,
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
		addEventListener: (
			type: string,
			listener: EventListenerOrEventListenerObject | null,
			options?: boolean | AddEventListenerOptions,
		) => targetFor(type, options).addEventListener(type, listener, options),
		removeEventListener: (
			type: string,
			listener: EventListenerOrEventListenerObject | null,
			options?: boolean | EventListenerOptions,
		) => targetFor(type, options).removeEventListener(type, listener, options),
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
		// The version the web build shows (its Vite config reads the same file).
		__APP_VERSION__: desktopApp.version,
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
			clipboard: { writeText: async (text: string) => env.copyText(text) },
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
	/** The window became the key window, or stopped being it: `focus` / `blur` on `window`. */
	const setWindowFocus = (focused: boolean) => {
		if (focused === isWindowFocused) return
		isWindowFocused = focused
		windowTarget.dispatchEvent(new Event(focused ? "focus" : "blur"))
	}
	/** Hears every change to `<html>`'s class or inline custom properties; returns how to stop. */
	const onRootStyle = (listener: () => void) => {
		rootStyleListeners.add(listener)
		return () => {
			rootStyleListeners.delete(listener)
		}
	}
	return {
		updateEnv,
		setWindowFocus,
		/** Saves `localStorage` now: the runtime is about to end. */
		flushStorage: () => localStorage.flush(),
		history,
		location,
		rootStyle: rootStyle as ReadonlyMap<string, string>,
		/** The theme `<html>`'s class names (the app's resolved theme), if it names one. */
		rootTheme: (): "dark" | "light" | undefined =>
			rootClasses.contains("dark") ? "dark" : rootClasses.contains("light") ? "light" : undefined,
		onRootStyle,
		/** An element scrolled: the window's capturing `scroll` listeners hear it. */
		dispatchElementScroll: () => capturedScrolls.dispatchEvent(new Event("scroll")),
	}
}

type ObserverLike = { observe(target: Node): void; disconnect(): void }

/**
 * A `MutationObserver` that also hears `<html>`: the app re-reads its theme for HTML render frames
 * when the root's class or style changes. Every other target goes to `Elements` (the bridge's
 * observer, over element proxies).
 */
export const makeRootAwareMutationObserver = (
	Elements: new (callback: () => void) => ObserverLike,
	root: Node,
	onRootChange: (listener: () => void) => () => void,
) =>
	class RootAwareMutationObserver {
		private readonly elements: ObserverLike
		private stopRoot: (() => void) | undefined
		private readonly notify: () => void
		constructor(callback: (records: Array<never>, observer: RootAwareMutationObserver) => void) {
			this.notify = () => callback([], this)
			this.elements = new Elements(this.notify)
		}
		observe(target: Node) {
			if (target === root) this.stopRoot ??= onRootChange(this.notify)
			else this.elements.observe(target)
		}
		disconnect() {
			this.stopRoot?.()
			this.stopRoot = undefined
			this.elements.disconnect()
		}
		takeRecords() {
			return []
		}
	}

/** Web and mail links open in the user's browser or mail app; any other scheme is dropped. */
export const openExternal = (target: URL, openUrl: (href: string) => void) => {
	if (["http:", "https:", "mailto:"].includes(target.protocol)) openUrl(target.href)
}
