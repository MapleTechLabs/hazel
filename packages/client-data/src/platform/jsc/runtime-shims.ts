/**
 * Shims for the two web APIs Effect's `HttpClient.make` constructs on every request and a bare
 * JSContext lacks: `URL` (with `URLSearchParams`) and `AbortController`. Minimal by design: absolute
 * and path-relative http(s)/ws(s) URLs, and abort signals with listeners. Installed only if missing.
 */
type Init = string | Iterable<readonly [string, string]> | Record<string, string> | undefined

const encode = (value: string) => encodeURIComponent(value).replace(/%20/g, "+")
const decode = (value: string) => decodeURIComponent(value.replace(/\+/g, " "))

class MiniURLSearchParams {
	private list: Array<[string, string]> = []
	constructor(init?: Init) {
		if (typeof init === "string") {
			for (const part of init.replace(/^\?/, "").split("&")) {
				if (part === "") continue
				const at = part.indexOf("=")
				this.list.push(at < 0 ? [decode(part), ""] : [decode(part.slice(0, at)), decode(part.slice(at + 1))])
			}
		} else if (init !== undefined) {
			const entries = Symbol.iterator in init ? init : Object.entries(init)
			for (const [key, value] of entries as Iterable<readonly [string, string]>)
				this.list.push([key, value])
		}
	}
	get size() {
		return this.list.length
	}
	append(key: string, value: string) {
		this.list.push([key, String(value)])
	}
	set(key: string, value: string) {
		this.delete(key)
		this.append(key, value)
	}
	get(key: string) {
		return this.list.find(([k]) => k === key)?.[1] ?? null
	}
	getAll(key: string) {
		return this.list.filter(([k]) => k === key).map(([, v]) => v)
	}
	has(key: string) {
		return this.list.some(([k]) => k === key)
	}
	delete(key: string) {
		this.list = this.list.filter(([k]) => k !== key)
	}
	forEach(f: (value: string, key: string) => void) {
		for (const [k, v] of this.list) f(v, k)
	}
	entries() {
		return this.list[Symbol.iterator]()
	}
	keys() {
		return this.list.map(([k]) => k)[Symbol.iterator]()
	}
	values() {
		return this.list.map(([, v]) => v)[Symbol.iterator]()
	}
	[Symbol.iterator]() {
		return this.entries()
	}
	toString() {
		return this.list.map(([k, v]) => `${encode(k)}=${encode(v)}`).join("&")
	}
}

const ABSOLUTE = /^([a-z][a-z\d+.-]*:)\/\/(?:([^:@/]*)(?::([^@/]*))?@)?([^:/?#]*)(?::(\d+))?([^?#]*)(\?[^#]*)?(#.*)?$/i

class MiniURL {
	protocol = ""
	username = ""
	password = ""
	hostname = ""
	port = ""
	pathname = "/"
	searchParams = new MiniURLSearchParams()
	private fragment = ""

	constructor(input: string | MiniURL, base?: string | MiniURL) {
		const text = String(input)
		const match = ABSOLUTE.exec(text) ?? (base === undefined ? null : ABSOLUTE.exec(MiniURL.resolve(text, String(base))))
		if (match === null) throw new TypeError(`Invalid URL: ${text}`)
		const [, protocol = "", user = "", pass = "", host = "", port = "", path = "", search = "", hash = ""] = match
		this.protocol = protocol.toLowerCase()
		this.username = user
		this.password = pass
		this.hostname = host.toLowerCase()
		this.port = port
		this.pathname = path === "" ? "/" : path
		this.searchParams = new MiniURLSearchParams(search)
		this.fragment = hash
	}

	/** `text` against `base`: path-absolute (`/x`), query-only (`?x`) or relative to its directory. */
	private static resolve(text: string, base: string): string {
		const root = new MiniURL(base)
		if (text.startsWith("/")) return `${root.origin}${text}`
		if (text.startsWith("?") || text.startsWith("#") || text === "") return `${root.origin}${root.pathname}${text}`
		return `${root.origin}${root.pathname.replace(/[^/]*$/, "")}${text}`
	}

	get host() {
		return this.port === "" ? this.hostname : `${this.hostname}:${this.port}`
	}
	get origin() {
		return `${this.protocol}//${this.host}`
	}
	get search() {
		const query = this.searchParams.toString()
		return query === "" ? "" : `?${query}`
	}
	set search(value: string) {
		this.searchParams = new MiniURLSearchParams(value)
	}
	get hash() {
		return this.fragment === "#" ? "" : this.fragment
	}
	set hash(value: string) {
		this.fragment = value === "" ? "" : value.startsWith("#") ? value : `#${value}`
	}
	get href() {
		const auth = this.username === "" ? "" : `${this.username}${this.password === "" ? "" : `:${this.password}`}@`
		return `${this.protocol}//${auth}${this.host}${this.pathname}${this.search}${this.hash}`
	}
	toString() {
		return this.href
	}
	toJSON() {
		return this.href
	}
	static canParse(input: string, base?: string) {
		try {
			new MiniURL(input, base)
			return true
		} catch {
			return false
		}
	}
	static parse(input: string, base?: string) {
		try {
			return new MiniURL(input, base)
		} catch {
			return null
		}
	}
}

type Listener = (event: { readonly type: "abort"; readonly target: MiniAbortSignal }) => void

class MiniAbortSignal {
	aborted = false
	reason: unknown = undefined
	onabort: Listener | null = null
	private listeners = new Set<Listener>()
	addEventListener(type: string, listener: Listener, options?: { once?: boolean }) {
		if (type !== "abort") return
		if (options?.once === true) {
			const once: Listener = (event) => {
				this.listeners.delete(once)
				listener(event)
			}
			this.listeners.add(once)
		} else this.listeners.add(listener)
	}
	removeEventListener(type: string, listener: Listener) {
		if (type === "abort") this.listeners.delete(listener)
	}
	throwIfAborted() {
		if (this.aborted) throw this.reason
	}
	/** @internal */
	fire(reason: unknown) {
		if (this.aborted) return
		this.aborted = true
		this.reason = reason ?? new Error("This operation was aborted")
		const event = { type: "abort" as const, target: this }
		this.onabort?.(event)
		for (const listener of [...this.listeners]) listener(event)
	}
	static abort(reason?: unknown) {
		const signal = new MiniAbortSignal()
		signal.fire(reason)
		return signal
	}
	static any(signals: Iterable<MiniAbortSignal>) {
		const signal = new MiniAbortSignal()
		for (const source of signals) {
			if (source.aborted) signal.fire(source.reason)
			else source.addEventListener("abort", () => signal.fire(source.reason), { once: true })
		}
		return signal
	}
}

class MiniAbortController {
	readonly signal = new MiniAbortSignal()
	abort(reason?: unknown) {
		this.signal.fire(reason)
	}
}

/** The shims this context needed: the names of the globals that were missing and are now installed. */
export const installRuntimeShims = (): ReadonlyArray<string> => {
	const g = globalThis as Record<string, unknown>
	const shims: Record<string, unknown> = {
		URL: MiniURL,
		URLSearchParams: MiniURLSearchParams,
		AbortController: MiniAbortController,
		AbortSignal: MiniAbortSignal,
	}
	const installed: Array<string> = []
	for (const [name, value] of Object.entries(shims)) {
		if (g[name] !== undefined) continue
		g[name] = value
		installed.push(name)
	}
	return installed
}
