/**
 * The web APIs of the runtime baseline (`../runtime-baseline.ts`) that a bare JSContext lacks:
 * `URL` and `URLSearchParams` (WHATWG parsing, serialization and setters, without IDNA),
 * `AbortController` and `AbortSignal` (`abort`, `timeout`, `any`), UTF-8 `TextEncoder` and
 * `TextDecoder`, and `queueMicrotask`. `installRuntimeShims` installs each one only if missing.
 */

// UTF-8

/** UTF-8 bytes of `text`; a lone surrogate becomes U+FFFD, as `TextEncoder` does. */
export const utf8Encode = (text: string): Uint8Array => {
	const out: Array<number> = []
	for (let i = 0; i < text.length; i++) {
		let code = text.charCodeAt(i)
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = text.charCodeAt(i + 1)
			if (next >= 0xdc00 && next <= 0xdfff) {
				code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00)
				i++
			} else code = 0xfffd
		} else if (code >= 0xdc00 && code <= 0xdfff) code = 0xfffd
		if (code < 0x80) out.push(code)
		else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63))
		else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63))
		else
			out.push(
				0xf0 | (code >> 18),
				0x80 | ((code >> 12) & 63),
				0x80 | ((code >> 6) & 63),
				0x80 | (code & 63),
			)
	}
	return Uint8Array.from(out)
}

/**
 * Decodes UTF-8 from `bytes[start, end)`. Malformed input becomes U+FFFD (the WHATWG rules: one per
 * maximal invalid subpart). With `stream`, an incomplete sequence at the end is returned as `rest`.
 */
const utf8DecodeRange = (
	bytes: Uint8Array,
	stream: boolean,
): { readonly text: string; readonly rest: Uint8Array; readonly replaced: boolean } => {
	let text = ""
	let replaced = false
	let chunk: Array<number> = []
	const flush = () => {
		text += String.fromCharCode(...chunk)
		chunk = []
	}
	const push = (code: number) => {
		if (code > 0xffff) {
			code -= 0x10000
			chunk.push(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff))
		} else chunk.push(code)
		if (chunk.length > 8192) flush()
	}
	let i = 0
	while (i < bytes.length) {
		const lead = bytes[i] ?? 0
		if (lead < 0x80) {
			push(lead)
			i++
			continue
		}
		const needed =
			lead >= 0xc2 && lead <= 0xdf
				? 1
				: lead >= 0xe0 && lead <= 0xef
					? 2
					: lead >= 0xf0 && lead <= 0xf4
						? 3
						: -1
		if (needed < 0) {
			replaced = true
			push(0xfffd)
			i++
			continue
		}
		let code = lead & (needed === 1 ? 0x1f : needed === 2 ? 0x0f : 0x07)
		let lower = 0x80
		let upper = 0xbf
		if (lead === 0xe0) lower = 0xa0
		else if (lead === 0xed) upper = 0x9f
		else if (lead === 0xf0) lower = 0x90
		else if (lead === 0xf4) upper = 0x8f
		let seen = 0
		let j = i + 1
		while (seen < needed) {
			if (j >= bytes.length) {
				if (stream) {
					flush()
					return { text, rest: bytes.slice(i), replaced }
				}
				break
			}
			const byte = bytes[j] ?? 0
			if (byte < lower || byte > upper) break
			lower = 0x80
			upper = 0xbf
			code = (code << 6) | (byte & 0x3f)
			seen++
			j++
		}
		if (seen === needed) push(code)
		else {
			replaced = true
			push(0xfffd)
		}
		i = j
	}
	flush()
	return { text, rest: new Uint8Array(0), replaced }
}

export const utf8Decode = (bytes: Uint8Array): string => utf8DecodeRange(bytes, false).text

const viewOf = (input?: ArrayBuffer | ArrayBufferView): Uint8Array =>
	input === undefined
		? new Uint8Array(0)
		: input instanceof ArrayBuffer
			? new Uint8Array(input)
			: new Uint8Array(input.buffer, input.byteOffset, input.byteLength)

export class ShimTextEncoder {
	readonly encoding = "utf-8"
	encode(input = ""): Uint8Array {
		return utf8Encode(String(input))
	}
	encodeInto(input: string, into: Uint8Array): { read: number; written: number } {
		const bytes = utf8Encode(input)
		const written = Math.min(bytes.length, into.length)
		// Never splits a character: back off to the last whole sequence.
		let end = written
		while (end > 0 && end < bytes.length && ((bytes[end] ?? 0) & 0xc0) === 0x80) end--
		into.set(bytes.subarray(0, end))
		return { read: utf8Decode(bytes.subarray(0, end)).length, written: end }
	}
}

export class ShimTextDecoder {
	readonly encoding = "utf-8"
	readonly fatal: boolean
	readonly ignoreBOM: boolean
	private pending: Uint8Array = new Uint8Array(0)
	private seenStart = false

	constructor(label = "utf-8", options: { fatal?: boolean; ignoreBOM?: boolean } = {}) {
		if (!/^\s*(utf-?8|unicode-1-1-utf-8)\s*$/i.test(label))
			throw new RangeError(`Unsupported encoding: ${label}`)
		this.fatal = options.fatal === true
		this.ignoreBOM = options.ignoreBOM === true
	}

	decode(input?: ArrayBuffer | ArrayBufferView, options: { stream?: boolean } = {}): string {
		const view = viewOf(input)
		const bytes = this.pending.length === 0 ? view : new Uint8Array([...this.pending, ...view])
		const stream = options.stream === true
		const { text, rest, replaced } = utf8DecodeRange(bytes, stream)
		if (this.fatal && replaced) {
			this.pending = new Uint8Array(0)
			throw new TypeError("The encoded data was not valid utf-8")
		}
		this.pending = rest
		let out = text
		if (!this.seenStart && out.length > 0) {
			if (!this.ignoreBOM && out.charCodeAt(0) === 0xfeff) out = out.slice(1)
			this.seenStart = true
		}
		if (!stream) {
			this.seenStart = false
			this.pending = new Uint8Array(0)
		}
		return out
	}
}

// Percent-encoding

const HEX = "0123456789ABCDEF"
const percent = (byte: number) => `%${HEX[byte >> 4]}${HEX[byte & 15]}`

/** The WHATWG percent-encode sets, as the ASCII characters each adds to C0 controls and non-ASCII. */
const C0 = ""
const FRAGMENT = `${C0} "<>\``
const QUERY = `${C0} "#<>`
const SPECIAL_QUERY = `${QUERY}'`
const PATH = `${QUERY}?\`{}^`
const USERINFO = `${PATH}/:;=@[\\]|`

const encodeSet = (text: string, set: string): string => {
	let out = ""
	for (const char of text) {
		const code = char.codePointAt(0) ?? 0
		if (code < 0x20 || code === 0x7f) out += percent(code)
		else if (code < 0x80) out += set.includes(char) ? percent(code) : char
		else for (const byte of utf8Encode(char)) out += percent(byte)
	}
	return out
}

const isHex = (char: string | undefined) => char !== undefined && /^[0-9a-f]$/i.test(char)

/** Percent-decoding to bytes, then UTF-8 with replacement (`%zz` stays as it is). */
const percentDecode = (text: string): string => {
	if (!text.includes("%")) return text
	const bytes: Array<number> = []
	for (let i = 0; i < text.length; i++) {
		const char = text[i] ?? ""
		if (char === "%" && isHex(text[i + 1]) && isHex(text[i + 2])) {
			bytes.push(parseInt(text.slice(i + 1, i + 3), 16))
			i += 2
		} else for (const byte of utf8Encode(char)) bytes.push(byte)
	}
	return utf8Decode(Uint8Array.from(bytes))
}

// URLSearchParams

/** `application/x-www-form-urlencoded` serialization of one name or value. */
const formEncode = (text: string): string => {
	let out = ""
	for (const byte of utf8Encode(text)) {
		const char = String.fromCharCode(byte)
		if (byte === 0x20) out += "+"
		else if (/^[A-Za-z0-9*\-._]$/.test(char)) out += char
		else out += percent(byte)
	}
	return out
}

const formDecode = (text: string) => percentDecode(text.replace(/\+/g, " "))

/** Replaces lone surrogates with U+FFFD, as the USVString conversion does. */
const usv = (value: unknown): string => utf8Decode(utf8Encode(String(value)))

type SearchInit =
	| string
	| ShimURLSearchParams
	| Iterable<readonly [string, string]>
	| Readonly<Record<string, string>>
	| undefined
	| null

export class ShimURLSearchParams {
	private list: Array<[string, string]> = []
	/** @internal The URL whose query this is: changes write back to it. */
	owner: ShimURL | undefined

	constructor(init?: SearchInit) {
		if (init === undefined || init === null) return
		if (typeof init === "string") {
			this.list = parseForm(init.startsWith("?") ? init.slice(1) : init)
			return
		}
		if (init instanceof ShimURLSearchParams) {
			this.list = init.list.map(([k, v]) => [k, v])
			return
		}
		if (Symbol.iterator in init) {
			for (const pair of init as Iterable<ReadonlyArray<string>>) {
				const entry = [...pair]
				if (entry.length !== 2) throw new TypeError("Each pair must have exactly two items")
				this.list.push([usv(entry[0]), usv(entry[1])])
			}
			return
		}
		for (const key of Object.keys(init))
			this.list.push([usv(key), usv((init as Record<string, string>)[key])])
	}

	/** @internal Replaces the list from a query string (the owner's `search` changed). */
	reset(query: string) {
		this.list = parseForm(query)
	}

	private update() {
		this.owner?.setQueryFromParams(this.toString())
	}

	get size() {
		return this.list.length
	}
	append(name: string, value: string) {
		this.list.push([usv(name), usv(value)])
		this.update()
	}
	delete(name: string, value?: string) {
		const key = usv(name)
		const match = value === undefined ? undefined : usv(value)
		this.list = this.list.filter(([k, v]) => k !== key || (match !== undefined && v !== match))
		this.update()
	}
	get(name: string): string | null {
		const key = usv(name)
		return this.list.find(([k]) => k === key)?.[1] ?? null
	}
	getAll(name: string): Array<string> {
		const key = usv(name)
		return this.list.filter(([k]) => k === key).map(([, v]) => v)
	}
	has(name: string, value?: string): boolean {
		const key = usv(name)
		const match = value === undefined ? undefined : usv(value)
		return this.list.some(([k, v]) => k === key && (match === undefined || v === match))
	}
	set(name: string, value: string) {
		const key = usv(name)
		const at = this.list.findIndex(([k]) => k === key)
		if (at < 0) this.list.push([key, usv(value)])
		else {
			this.list[at] = [key, usv(value)]
			this.list = this.list.filter(([k], index) => k !== key || index <= at)
		}
		this.update()
	}
	/** Stable, by UTF-16 code units of the name. */
	sort() {
		this.list = this.list
			.map((entry, index) => ({ entry, index }))
			.sort((a, b) => (a.entry[0] < b.entry[0] ? -1 : a.entry[0] > b.entry[0] ? 1 : a.index - b.index))
			.map(({ entry }) => entry)
		this.update()
	}
	forEach(callback: (value: string, name: string, params: ShimURLSearchParams) => void, thisArg?: unknown) {
		for (let i = 0; i < this.list.length; i++) {
			const [k, v] = this.list[i] ?? ["", ""]
			callback.call(thisArg, v, k, this)
		}
	}
	*entries(): IterableIterator<[string, string]> {
		for (let i = 0; i < this.list.length; i++) yield [...(this.list[i] ?? ["", ""])]
	}
	*keys(): IterableIterator<string> {
		for (const [k] of this.entries()) yield k
	}
	*values(): IterableIterator<string> {
		for (const [, v] of this.entries()) yield v
	}
	[Symbol.iterator]() {
		return this.entries()
	}
	toString() {
		return this.list.map(([k, v]) => `${formEncode(k)}=${formEncode(v)}`).join("&")
	}
	get [Symbol.toStringTag]() {
		return "URLSearchParams"
	}
}

const parseForm = (query: string): Array<[string, string]> => {
	const list: Array<[string, string]> = []
	for (const part of query.split("&")) {
		if (part === "") continue
		const at = part.indexOf("=")
		list.push(
			at < 0 ? [formDecode(part), ""] : [formDecode(part.slice(0, at)), formDecode(part.slice(at + 1))],
		)
	}
	return list
}

// URL

const DEFAULT_PORTS = new Map([
	["http:", "80"],
	["https:", "443"],
	["ws:", "80"],
	["wss:", "443"],
	["ftp:", "21"],
])
const isSpecial = (protocol: string) => DEFAULT_PORTS.has(protocol) || protocol === "file:"

const FORBIDDEN_HOST = /[\u0000\t\n\r #/:<>?@[\\\]^|]/
const FORBIDDEN_DOMAIN = /[\u0000-\u001f\t\n\r #%/:<>?@[\\\]^|\u007f]/

/** One IPv4 part: decimal, `0x` hex or leading-zero octal. */
const ipv4Part = (part: string): number | undefined => {
	if (part === "") return undefined
	if (/^0x[0-9a-f]*$/i.test(part)) return part.length === 2 ? 0 : parseInt(part.slice(2), 16)
	if (/^0[0-7]+$/.test(part)) return parseInt(part.slice(1), 8)
	if (/^(0|[1-9][0-9]*)$/.test(part)) return Number(part)
	return undefined
}

/** The host as an IPv4 address, `null` when it is not one, or throws when it is a bad one. */
const parseIPv4 = (host: string): string | null => {
	const parts = host.split(".")
	if (parts[parts.length - 1] === "" && parts.length > 1) parts.pop()
	const last = parts[parts.length - 1] ?? ""
	// The WHATWG "ends in a number" check: otherwise a domain.
	if (!(/^[0-9]+$/.test(last) || /^0x[0-9a-f]*$/i.test(last))) return null
	if (parts.length > 4) throw new TypeError("Invalid URL: bad IPv4 address")
	const numbers = parts.map(ipv4Part)
	if (numbers.some((n) => n === undefined)) throw new TypeError("Invalid URL: bad IPv4 address")
	const values = numbers as Array<number>
	if (values.slice(0, -1).some((n) => n > 255)) throw new TypeError("Invalid URL: bad IPv4 address")
	if ((values[values.length - 1] ?? 0) >= 256 ** (5 - values.length))
		throw new TypeError("Invalid URL: bad IPv4 address")
	let address = values[values.length - 1] ?? 0
	for (let i = 0; i < values.length - 1; i++) address += (values[i] ?? 0) * 256 ** (3 - i)
	return [address >>> 24, (address >>> 16) & 255, (address >>> 8) & 255, address & 255].join(".")
}

/** `[...]` contents, compressed and lowercased (RFC 5952). */
const parseIPv6 = (input: string): string => {
	const bad = () => new TypeError(`Invalid URL: bad IPv6 address [${input}]`)
	let text = input.toLowerCase()
	const v4 = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(text)
	if (v4 !== null) {
		const octets = (v4[2] ?? "").split(".").map(Number)
		if (
			octets.some((o) => o > 255) ||
			(v4[2] ?? "").split(".").some((o) => o.length > 1 && o.startsWith("0"))
		)
			throw bad()
		text = `${v4[1]}${(((octets[0] ?? 0) << 8) | (octets[1] ?? 0)).toString(16)}:${(((octets[2] ?? 0) << 8) | (octets[3] ?? 0)).toString(16)}`
	}
	const halves = text.split("::")
	if (halves.length > 2) throw bad()
	const groups = (part: string) => (part === "" ? [] : part.split(":"))
	const head = groups(halves[0] ?? "")
	const tail = halves.length === 2 ? groups(halves[1] ?? "") : []
	if ([...head, ...tail].some((g) => !/^[0-9a-f]{1,4}$/.test(g))) throw bad()
	const missing = 8 - head.length - tail.length
	if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) throw bad()
	const pieces = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail].map(
		(g) => parseInt(g, 16),
	)
	// The longest run of two or more zeros becomes `::`.
	let best = -1
	let bestLength = 1
	for (let i = 0; i < 8;) {
		if (pieces[i] !== 0) {
			i++
			continue
		}
		let j = i
		while (j < 8 && pieces[j] === 0) j++
		if (j - i > bestLength) {
			best = i
			bestLength = j - i
		}
		i = j
	}
	const hex = pieces.map((p) => p.toString(16))
	if (best < 0) return `[${hex.join(":")}]`
	return `[${hex.slice(0, best).join(":")}::${hex.slice(best + bestLength).join(":")}]`
}

const parseHost = (input: string, special: boolean): string => {
	if (input.startsWith("[")) {
		if (!input.endsWith("]")) throw new TypeError("Invalid URL: unclosed IPv6 address")
		return parseIPv6(input.slice(1, -1))
	}
	if (!special) {
		if (FORBIDDEN_HOST.test(input)) throw new TypeError(`Invalid URL: bad host ${input}`)
		return encodeSet(input, "")
	}
	// No IDNA: a non-ASCII domain is refused rather than sent unconverted.
	const domain = percentDecode(input).toLowerCase()
	if (domain === "") throw new TypeError("Invalid URL: empty host")
	if (/[^\u0000-\u007f]/.test(domain))
		throw new TypeError(`Invalid URL: non-ASCII host ${input} (no IDNA here)`)
	if (FORBIDDEN_DOMAIN.test(domain)) throw new TypeError(`Invalid URL: bad host ${input}`)
	return parseIPv4(domain) ?? domain
}

const isSingleDot = (segment: string) => segment === "." || segment.toLowerCase() === "%2e"
const isDoubleDot = (segment: string) => /^(\.|%2e)(\.|%2e)$/i.test(segment)
const isWindowsLetter = (segment: string) => /^[a-zA-Z][:|]$/.test(segment)

/** Path segments of `input` (already without query and fragment), resolved onto `base`. */
const parsePath = (
	input: string,
	special: boolean,
	base: ReadonlyArray<string>,
	protocol: string,
): Array<string> => {
	const segments = [...base]
	const parts = (special ? input.replace(/\\/g, "/") : input).split("/")
	for (let i = 0; i < parts.length; i++) {
		const raw = parts[i] ?? ""
		const last = i === parts.length - 1
		if (isDoubleDot(raw)) {
			if (!(protocol === "file:" && segments.length === 1 && isWindowsLetter(segments[0] ?? "")))
				segments.pop()
			if (last) segments.push("")
		} else if (isSingleDot(raw)) {
			if (last) segments.push("")
		} else segments.push(encodeSet(raw, PATH))
	}
	return segments
}

interface Parts {
	protocol: string
	username: string
	password: string
	hostname: string
	port: string
	/** Segments, or `opaque` for a URL like `mailto:x`. */
	path: Array<string>
	opaque: string | undefined
	query: string | null
	fragment: string | null
	hasAuthority: boolean
}

const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/

const splitTail = (rest: string): { body: string; query: string | null; fragment: string | null } => {
	let fragment: string | null = null
	const hashAt = rest.indexOf("#")
	if (hashAt >= 0) {
		fragment = rest.slice(hashAt + 1)
		rest = rest.slice(0, hashAt)
	}
	let query: string | null = null
	const queryAt = rest.indexOf("?")
	if (queryAt >= 0) {
		query = rest.slice(queryAt + 1)
		rest = rest.slice(0, queryAt)
	}
	return { body: rest, query, fragment }
}

const parseAuthority = (parts: Parts, authority: string, special: boolean) => {
	const at = authority.lastIndexOf("@")
	if (at >= 0) {
		const userinfo = authority.slice(0, at)
		const colon = userinfo.indexOf(":")
		parts.username = encodeSet(colon < 0 ? userinfo : userinfo.slice(0, colon), USERINFO)
		parts.password = colon < 0 ? "" : encodeSet(userinfo.slice(colon + 1), USERINFO)
		authority = authority.slice(at + 1)
	}
	const portMatch = /:([^:\]]*)$/.exec(authority)
	let host = authority
	if (portMatch !== null) {
		host = authority.slice(0, portMatch.index)
		const port = portMatch[1] ?? ""
		if (!/^[0-9]*$/.test(port)) throw new TypeError("Invalid URL: bad port")
		if (port !== "") {
			const value = Number(port)
			if (value > 65535) throw new TypeError("Invalid URL: port out of range")
			parts.port = String(value) === DEFAULT_PORTS.get(parts.protocol) ? "" : String(value)
		}
	}
	if (host === "" && special && parts.protocol !== "file:") throw new TypeError("Invalid URL: empty host")
	if (host === "" && (parts.username !== "" || parts.password !== "" || parts.port !== ""))
		throw new TypeError("Invalid URL: credentials or port without a host")
	parts.hostname = host === "" ? "" : parseHost(host, special)
	if (parts.protocol === "file:" && parts.hostname === "localhost") parts.hostname = ""
}

const encodeQuery = (query: string | null, special: boolean) =>
	query === null ? null : encodeSet(query, special ? SPECIAL_QUERY : QUERY)

const parseURL = (rawInput: string, base: Parts | undefined): Parts => {
	const input = rawInput.replace(/^[\u0000- ]+|[\u0000- ]+$/g, "").replace(/[\t\n\r]/g, "")
	const scheme = SCHEME.exec(input)
	if (scheme !== null) {
		const protocol = `${(scheme[1] ?? "").toLowerCase()}:`
		const special = isSpecial(protocol)
		const rest = input.slice(scheme[0].length)
		// `http:foo` against an `http:` base is relative to it.
		if (special && base !== undefined && base.protocol === protocol && !/^[/\\]/.test(rest))
			return resolveRelative(rest, base)
		const parts: Parts = {
			protocol,
			username: "",
			password: "",
			hostname: "",
			port: "",
			path: [],
			opaque: undefined,
			query: null,
			fragment: null,
			hasAuthority: false,
		}
		const { body, query, fragment } = splitTail(rest)
		parts.query = encodeQuery(query, special)
		parts.fragment = fragment === null ? null : encodeSet(fragment, FRAGMENT)
		if (special || body.startsWith("//")) {
			// `file:` takes exactly two slashes before its (often empty) host.
			const afterSlashes =
				protocol === "file:"
					? body.replace(/^[/\\]{2}/, "")
					: special
						? body.replace(/^[/\\]*/, "")
						: body.slice(2)
			const end = afterSlashes.search(special ? /[/\\]/ : /\//)
			const authority = end < 0 ? afterSlashes : afterSlashes.slice(0, end)
			parseAuthority(parts, authority, special)
			parts.hasAuthority = true
			const path = end < 0 ? "" : afterSlashes.slice(end + 1)
			parts.path = end < 0 && !special ? [] : parsePath(path, special, [], protocol)
			if (special && parts.path.length === 0) parts.path = [""]
			return parts
		}
		if (body.startsWith("/")) {
			parts.path = parsePath(body.slice(1), false, [], protocol)
			return parts
		}
		parts.opaque = encodeSet(body, C0)
		return parts
	}
	if (base === undefined) throw new TypeError(`Invalid URL: ${rawInput}`)
	return resolveRelative(input, base)
}

const resolveRelative = (input: string, base: Parts): Parts => {
	const special = isSpecial(base.protocol)
	const { body, query, fragment } = splitTail(input)
	const parts: Parts = {
		...base,
		path: [...base.path],
		fragment: fragment === null ? null : encodeSet(fragment, FRAGMENT),
	}
	if (base.opaque !== undefined) {
		if (body !== "" || query !== null || !input.startsWith("#"))
			throw new TypeError(`Invalid URL: ${input}`)
		return parts
	}
	const slash = special ? /^[/\\]/ : /^\//
	if (special ? /^[/\\]{2}/.test(body) : body.startsWith("//")) {
		return parseURL(`${base.protocol}${input}`, undefined)
	}
	if (slash.test(body)) {
		parts.path = parsePath(body.slice(1), special, [], base.protocol)
		parts.query = encodeQuery(query, special)
		return parts
	}
	if (body === "") {
		if (query !== null) parts.query = encodeQuery(query, special)
		return parts
	}
	parts.path = parsePath(body, special, base.path.slice(0, -1), base.protocol)
	parts.query = encodeQuery(query, special)
	return parts
}

export class ShimURL {
	private parts: Parts
	private params: ShimURLSearchParams

	constructor(input: string | ShimURL, base?: string | ShimURL) {
		const baseParts = base === undefined ? undefined : new ShimURL(String(base)).parts
		this.parts = parseURL(String(input), baseParts)
		this.params = new ShimURLSearchParams(this.parts.query ?? "")
		this.params.owner = this
	}

	static canParse(input: string, base?: string): boolean {
		return ShimURL.parse(input, base) !== null
	}
	static parse(input: string, base?: string): ShimURL | null {
		try {
			return new ShimURL(input, base)
		} catch {
			return null
		}
	}

	/** @internal The search params changed. */
	setQueryFromParams(query: string) {
		this.parts.query = query === "" ? null : query
	}

	private get special() {
		return isSpecial(this.parts.protocol)
	}

	get href(): string {
		const p = this.parts
		let out = p.protocol
		if (p.hasAuthority || p.hostname !== "") {
			out += "//"
			if (p.username !== "" || p.password !== "")
				out += `${p.username}${p.password === "" ? "" : `:${p.password}`}@`
			out += this.host
		} else if (p.opaque === undefined && p.path.length > 1 && p.path[0] === "") out += "/."
		out += this.pathname
		if (p.query !== null) out += `?${p.query}`
		if (p.fragment !== null) out += `#${p.fragment}`
		return out
	}
	set href(value: string) {
		this.parts = parseURL(value, undefined)
		this.params.reset(this.parts.query ?? "")
	}
	get origin(): string {
		const p = this.parts
		if (!DEFAULT_PORTS.has(p.protocol)) return "null"
		return `${p.protocol}//${this.host}`
	}
	get protocol() {
		return this.parts.protocol
	}
	set protocol(value: string) {
		const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):?/.exec(value)
		if (match === null) return
		const next = `${(match[1] ?? "").toLowerCase()}:`
		// Special and non-special schemes do not trade places (the WHATWG rule).
		if (isSpecial(next) !== this.special) return
		this.parts.protocol = next
		if (this.parts.port === DEFAULT_PORTS.get(next)) this.parts.port = ""
	}
	get username() {
		return this.parts.username
	}
	set username(value: string) {
		if (this.parts.hostname === "" || this.parts.protocol === "file:") return
		this.parts.username = encodeSet(value, USERINFO)
	}
	get password() {
		return this.parts.password
	}
	set password(value: string) {
		if (this.parts.hostname === "" || this.parts.protocol === "file:") return
		this.parts.password = encodeSet(value, USERINFO)
	}
	get host() {
		return this.parts.port === "" ? this.parts.hostname : `${this.parts.hostname}:${this.parts.port}`
	}
	set host(value: string) {
		if (this.parts.opaque !== undefined) return
		try {
			const next = parseURL(`${this.parts.protocol}//${value.split(/[/?#\\]/)[0]}`, undefined)
			this.parts.hostname = next.hostname
			if (/:[0-9]*$/.test(value.split(/[/?#\\]/)[0] ?? "")) this.parts.port = next.port
		} catch {}
	}
	get hostname() {
		return this.parts.hostname
	}
	set hostname(value: string) {
		if (this.parts.opaque !== undefined) return
		try {
			this.parts.hostname = parseHost(value.split(/[/?#:\\]/)[0] ?? "", this.special)
		} catch {}
	}
	get port() {
		return this.parts.port
	}
	set port(value: string) {
		if (this.parts.hostname === "" || this.parts.protocol === "file:") return
		const digits = /^[0-9]*/.exec(String(value))?.[0] ?? ""
		if (digits === "" && String(value) !== "") return
		if (digits === "") {
			this.parts.port = ""
			return
		}
		const port = Number(digits)
		if (port > 65535) return
		this.parts.port = String(port) === DEFAULT_PORTS.get(this.parts.protocol) ? "" : String(port)
	}
	get pathname(): string {
		const p = this.parts
		if (p.opaque !== undefined) return p.opaque
		return p.path.length === 0 ? "" : `/${p.path.join("/")}`
	}
	set pathname(value: string) {
		if (this.parts.opaque !== undefined) return
		const text = this.special ? value.replace(/^[/\\]/, "") : value.replace(/^\//, "")
		this.parts.path = parsePath(text, this.special, [], this.parts.protocol)
	}
	get search(): string {
		const query = this.parts.query
		return query === null || query === "" ? "" : `?${query}`
	}
	set search(value: string) {
		const text = value.startsWith("?") ? value.slice(1) : value
		this.parts.query = value === "" ? null : encodeQuery(text, this.special)
		this.params.reset(this.parts.query ?? "")
	}
	get searchParams(): ShimURLSearchParams {
		return this.params
	}
	get hash(): string {
		const fragment = this.parts.fragment
		return fragment === null || fragment === "" ? "" : `#${fragment}`
	}
	set hash(value: string) {
		const text = value.startsWith("#") ? value.slice(1) : value
		this.parts.fragment = value === "" ? null : encodeSet(text, FRAGMENT)
	}
	toString() {
		return this.href
	}
	toJSON() {
		return this.href
	}
	get [Symbol.toStringTag]() {
		return "URL"
	}
}

// AbortController

/** An `Error` named as the DOMException the browser uses. */
const domError = (name: "AbortError" | "TimeoutError", message: string) => {
	const error = new Error(message)
	error.name = name
	return error
}

type AbortListener = ((event: AbortEvent) => void) | { readonly handleEvent: (event: AbortEvent) => void }

interface AbortEvent {
	readonly type: "abort"
	readonly target: ShimAbortSignal
	readonly currentTarget: ShimAbortSignal
}

export class ShimAbortSignal {
	aborted = false
	reason: unknown = undefined
	onabort: ((event: AbortEvent) => void) | null = null
	private listeners: Array<{ listener: AbortListener; once: boolean }> = []

	addEventListener(
		type: string,
		listener: AbortListener | null,
		options?: boolean | { once?: boolean; signal?: ShimAbortSignal },
	) {
		if (type !== "abort" || listener === null) return
		if (this.listeners.some((entry) => entry.listener === listener)) return
		const once = typeof options === "object" && options.once === true
		const signal = typeof options === "object" ? options.signal : undefined
		if (signal?.aborted === true) return
		this.listeners.push({ listener, once })
		signal?.addEventListener("abort", () => this.removeEventListener("abort", listener), { once: true })
	}
	removeEventListener(type: string, listener: AbortListener | null) {
		if (type !== "abort") return
		this.listeners = this.listeners.filter((entry) => entry.listener !== listener)
	}
	dispatchEvent(event: { readonly type: string }): boolean {
		if (event.type !== "abort") return true
		const abortEvent: AbortEvent = { type: "abort", target: this, currentTarget: this }
		this.onabort?.call(this, abortEvent)
		for (const entry of [...this.listeners]) {
			if (!this.listeners.includes(entry)) continue
			if (entry.once) this.removeEventListener("abort", entry.listener)
			try {
				if (typeof entry.listener === "function") entry.listener.call(this, abortEvent)
				else entry.listener.handleEvent(abortEvent)
			} catch (error) {
				// A throwing listener does not stop the others (as a DOM event's do not).
				setTimeout(() => {
					throw error
				}, 0)
			}
		}
		return true
	}
	throwIfAborted() {
		if (this.aborted) throw this.reason
	}
	/** @internal */
	signalAbort(reason: unknown) {
		if (this.aborted) return
		this.aborted = true
		this.reason = reason === undefined ? domError("AbortError", "This operation was aborted") : reason
		this.dispatchEvent({ type: "abort" })
	}
	static abort(reason?: unknown): ShimAbortSignal {
		const signal = new ShimAbortSignal()
		signal.signalAbort(reason)
		return signal
	}
	static timeout(ms: number): ShimAbortSignal {
		const signal = new ShimAbortSignal()
		setTimeout(() => signal.signalAbort(domError("TimeoutError", "The operation timed out")), ms)
		return signal
	}
	static any(signals: Iterable<ShimAbortSignal>): ShimAbortSignal {
		const signal = new ShimAbortSignal()
		const sources = [...signals]
		const aborted = sources.find((source) => source.aborted)
		if (aborted !== undefined) {
			signal.signalAbort(aborted.reason)
			return signal
		}
		for (const source of sources)
			source.addEventListener("abort", () => signal.signalAbort(source.reason), { once: true })
		return signal
	}
	get [Symbol.toStringTag]() {
		return "AbortSignal"
	}
}

export class ShimAbortController {
	readonly signal = new ShimAbortSignal()
	abort(reason?: unknown) {
		this.signal.signalAbort(reason)
	}
}

// crypto

/** What the host's bridge gives for randomness (`__native`, `./bridge.ts`), read when first used. */
interface RandomSource {
	readonly uuid: () => string
	readonly randomBytes?: (count: number) => Uint8Array
}

declare const __native: RandomSource | undefined

const randomSource = (): RandomSource => {
	if (typeof __native === "undefined")
		throw new Error("No secure random source: the host installed no __native")
	return __native
}

/**
 * `crypto.randomUUID` and `crypto.getRandomValues` over the host's secure random
 * (`SecRandomCopyBytes`, or its UUIDs on a host without `randomBytes`). TanStack DB's ids need them.
 */
export const ShimCrypto = {
	randomUUID: (): string => randomSource().uuid(),
	getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
		if (array === null) return array
		if (array.byteLength > 65536) throw new Error("QuotaExceededError: at most 65536 bytes")
		const view = new Uint8Array(array.buffer, array.byteOffset, array.byteLength)
		const source = randomSource()
		if (source.randomBytes !== undefined) view.set(source.randomBytes(view.length))
		else
			for (let at = 0; at < view.length;) {
				// 15 random bytes per UUID (the version and variant nibbles left out).
				const hex = source.uuid().replace(/-/g, "")
				const random = hex.slice(0, 12) + hex.slice(13, 16) + hex.slice(17)
				for (let i = 0; i + 2 <= random.length && at < view.length; i += 2)
					view[at++] = parseInt(random.slice(i, i + 2), 16)
			}
		return array
	},
}

/** Each shim with the global it fills. */
export const RUNTIME_SHIMS = {
	URL: ShimURL,
	URLSearchParams: ShimURLSearchParams,
	AbortController: ShimAbortController,
	AbortSignal: ShimAbortSignal,
	TextEncoder: ShimTextEncoder,
	TextDecoder: ShimTextDecoder,
	crypto: ShimCrypto,
	queueMicrotask: (task: () => void) => {
		Promise.resolve()
			.then(task)
			.catch((error: unknown) =>
				setTimeout(() => {
					throw error
				}, 0),
			)
	},
} as const

/** Installs every shim whose global is missing; returns the names it installed. */
export const installRuntimeShims = (): ReadonlyArray<string> => {
	const g = globalThis as Record<string, unknown>
	const installed: Array<string> = []
	for (const [name, value] of Object.entries(RUNTIME_SHIMS)) {
		if (g[name] !== undefined) continue
		g[name] = value
		installed.push(name)
	}
	return installed
}
