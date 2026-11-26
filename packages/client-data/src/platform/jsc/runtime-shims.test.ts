/** The shims checked against Node's own `URL`, `URLSearchParams`, `TextDecoder` and `AbortSignal`. */
import { describe, expect, test, vi } from "vitest"
import {
	installRuntimeShims,
	RUNTIME_SHIMS,
	ShimAbortController,
	ShimAbortSignal,
	ShimTextDecoder,
	ShimTextEncoder,
	ShimURL,
	ShimURLSearchParams,
} from "./runtime-shims"

const fields = [
	"href",
	"origin",
	"protocol",
	"username",
	"password",
	"host",
	"hostname",
	"port",
	"pathname",
	"search",
	"hash",
] as const
const view = (url: URL | ShimURL) => Object.fromEntries(fields.map((field) => [field, url[field]]))

const ABSOLUTE = [
	"http://example.com",
	"https://api.hazel.sh/rpc",
	"HTTPS://API.Hazel.SH:443/a/b?c=d#e",
	"http://127.0.0.1:4320/sync/mux?x=1",
	"ws://127.0.0.1:4320/sync/org/abc",
	"wss://api.hazel.sh:8443/sync",
	"http://user:p%40ss@host.test:8080/p",
	"http://u:p@host/",
	"http://host/a/./b/../c",
	"http://host/a/%2e/b/%2E%2e/c",
	"http://host/a b/ü?q=a b&r=ü#frag ü",
	"http://host/?a='b'",
	"http://host\\path\\x",
	"http://host:80/",
	"https://host:443",
	"http://[::1]:3000/x",
	"http://[2001:DB8:0:0:0:0:0:1]/",
	"http://[::ffff:192.168.0.1]/",
	"http://0x7f.1/",
	"http://192.168.1/",
	"http://host/path?",
	"http://host/path#",
	"http://host/%zz",
	"http://host/a?b#c?d#e",
	"https://cdn.brandfetch.io/linear.app/w/64/h/64/theme/dark/icon",
	"mailto:someone@example.com",
	"data:text/plain,hi there",
	"custom://authority/path?q#h",
	"custom:/path",
	"file:///tmp/x.txt",
	"file://localhost/etc/hosts",
	"  http://host/trim  ",
	"http://ho\tst/a\nb",
]

const RELATIVE: ReadonlyArray<readonly [string, string]> = [
	["/rpc", "http://127.0.0.1:4320"],
	["rpc", "http://127.0.0.1:4320/api/"],
	["rpc", "http://127.0.0.1:4320/api/v1"],
	["../up", "http://host/a/b/c"],
	["../../../../too-far", "http://host/a/b"],
	["?x=1", "http://host/a/b?y=2#z"],
	["#frag", "http://host/a/b?y=2#z"],
	["", "http://host/a/b?y=2#z"],
	["//other.host/p", "https://host/a"],
	["\\\\other.host\\p", "https://host/a"],
	["http:rel", "http://host/a/b"],
	["./", "http://host/a/b"],
	[".", "http://host/a/b"],
	["..", "http://host/a/b/"],
	["https://abs.test/x", "http://host/"],
	["sync/mux", "ws://127.0.0.1:4320/"],
	["#x", "mailto:a@b"],
]

const INVALID = [
	"",
	"not a url",
	"http://",
	"http://host:99999/",
	"http://host:12a/",
	"http://[::1/",
	"http://a b/",
	"//no-base",
]

describe("URL", () => {
	test.each(ABSOLUTE)("parses %j as Node does", (input) => {
		expect(view(new ShimURL(input))).toEqual(view(new URL(input)))
	})

	test.each(RELATIVE)("resolves %j against %j as Node does", (input, base) => {
		expect(view(new ShimURL(input, base))).toEqual(view(new URL(input, base)))
	})

	test.each(INVALID)("refuses %j", (input) => {
		expect(() => new URL(input)).toThrow()
		expect(() => new ShimURL(input)).toThrow(TypeError)
		expect(ShimURL.canParse(input)).toBe(false)
		expect(ShimURL.parse(input)).toBeNull()
	})

	test("setters match Node", () => {
		const edits: ReadonlyArray<(url: URL | ShimURL) => void> = [
			(u) => (u.search = "?a=1&b=two words"),
			(u) => (u.search = ""),
			(u) => (u.hash = "section 2"),
			(u) => (u.hash = ""),
			(u) => (u.pathname = "/new/../path ü"),
			(u) => (u.port = "8080"),
			(u) => (u.port = "80"),
			(u) => (u.port = ""),
			(u) => (u.hostname = "Other.Host"),
			(u) => (u.host = "h2.test:9000"),
			(u) => (u.username = "me@x"),
			(u) => (u.password = "s3cr:t"),
			(u) => (u.protocol = "https"),
			(u) => (u.protocol = "mailto"),
			(u) => (u.href = "ws://fresh.test/p?q#h"),
		]
		for (const edit of edits) {
			const node = new URL("http://user@host.test:81/a/b?x=1#f")
			const shim = new ShimURL("http://user@host.test:81/a/b?x=1#f")
			edit(node)
			edit(shim)
			expect(view(shim)).toEqual(view(node))
		}
	})

	test("searchParams write back to the URL, as Effect's HttpClient uses them", () => {
		const node = new URL("http://host/rpc?a=1")
		const shim = new ShimURL("http://host/rpc?a=1")
		for (const url of [node, shim]) {
			url.searchParams.append("b", "x y")
			url.searchParams.append("ü", "&=")
			url.searchParams.set("a", "2")
			url.hash = "h"
		}
		expect(shim.href).toBe(node.href)
		shim.searchParams.delete("a")
		node.searchParams.delete("a")
		expect(shim.href).toBe(node.href)
		shim.search = "?z=9"
		expect(shim.searchParams.get("z")).toBe("9")
		expect(String(shim)).toBe(shim.href)
		expect(JSON.stringify({ u: shim })).toBe(`{"u":"${shim.href}"}`)
	})
})

describe("URLSearchParams", () => {
	const inits: ReadonlyArray<string | Array<[string, string]> | Record<string, string>> = [
		"a=1&b=2&a=3",
		"?q=hello+world&x=%E2%9C%93&bad=%zz&empty=&noeq",
		"=&&&a==b",
		[
			["k", "v"],
			["k", "w w"],
		],
		{ one: "1", "two words": "ü & =" },
	]

	test.each(inits)("matches Node for %j", (init) => {
		const node = new URLSearchParams(init)
		const shim = new ShimURLSearchParams(init)
		expect(shim.toString()).toBe(node.toString())
		expect([...shim]).toEqual([...node])
		expect(shim.size).toBe(node.size)
	})

	test("methods match Node", () => {
		const node = new URLSearchParams("b=2&a=1&b=3&c=")
		const shim = new ShimURLSearchParams("b=2&a=1&b=3&c=")
		for (const params of [node, shim]) {
			params.set("b", "9")
			params.append("d", "~!*()'")
			params.sort()
		}
		expect(shim.toString()).toBe(node.toString())
		expect(shim.get("b")).toBe(node.get("b"))
		expect(shim.getAll("b")).toEqual(node.getAll("b"))
		expect(shim.has("a", "1")).toBe(node.has("a", "1"))
		expect(shim.has("a", "2")).toBe(node.has("a", "2"))
		shim.delete("a", "nope")
		node.delete("a", "nope")
		expect(shim.toString()).toBe(node.toString())
		const seen: Array<string> = []
		shim.forEach((value, key) => seen.push(`${key}:${value}`))
		expect(seen).toEqual([...node].map(([k, v]) => `${k}:${v}`))
		expect([...shim.keys()]).toEqual([...node.keys()])
		expect([...shim.values()]).toEqual([...node.values()])
		expect(new ShimURLSearchParams(shim).toString()).toBe(shim.toString())
	})
})

describe("TextEncoder and TextDecoder", () => {
	const samples = [
		"",
		"ascii",
		"ü",
		"日本語",
		"emoji 🎉 mix",
		"\u0000\u007f\u0080߿ࠀ￿",
		"\ud83d",
		"a\udc00b",
	]

	test.each(samples)("encodes %j as Node does", (text) => {
		expect([...new ShimTextEncoder().encode(text)]).toEqual([...new TextEncoder().encode(text)])
	})

	const bytes: ReadonlyArray<ReadonlyArray<number>> = [
		[0xef, 0xbb, 0xbf, 0x61],
		[0xc3, 0xbc, 0xe6, 0x97, 0xa5],
		[0xf0, 0x9f, 0x8e, 0x89],
		[0xff, 0x61, 0xc0, 0x80, 0xed, 0xa0, 0x80, 0xf4, 0x90, 0x80, 0x80],
		[0xe6, 0x97],
		[0x61, 0xf0, 0x9f, 0x8e],
	]

	test.each(bytes)("decodes %j as Node does", (...input) => {
		const data = Uint8Array.from(input)
		expect(new ShimTextDecoder().decode(data)).toBe(new TextDecoder().decode(data))
		expect(new ShimTextDecoder("utf-8", { ignoreBOM: true }).decode(data)).toBe(
			new TextDecoder("utf-8", { ignoreBOM: true }).decode(data),
		)
	})

	test("streams a character split across chunks", () => {
		const data = new TextEncoder().encode("ab🎉cd日")
		for (let cut = 0; cut <= data.length; cut++) {
			const node = new TextDecoder()
			const shim = new ShimTextDecoder()
			const first = data.subarray(0, cut)
			const second = data.subarray(cut)
			expect(shim.decode(first, { stream: true }) + shim.decode(second)).toBe(
				node.decode(first, { stream: true }) + node.decode(second),
			)
		}
	})

	test("fatal refuses malformed input, and only that", () => {
		expect(() => new ShimTextDecoder("utf-8", { fatal: true }).decode(Uint8Array.of(0xff))).toThrow(
			TypeError,
		)
		expect(new ShimTextDecoder("utf-8", { fatal: true }).decode(new TextEncoder().encode("ok �"))).toBe(
			"ok �",
		)
	})

	test("encodeInto never splits a character", () => {
		const into = new Uint8Array(5)
		const node = new TextEncoder().encodeInto("ab🎉", into.slice())
		expect(new ShimTextEncoder().encodeInto("ab🎉", into)).toEqual(node)
	})
})

describe("AbortController and AbortSignal", () => {
	test("abort fires listeners once, with Node's reason shape", () => {
		const controller = new ShimAbortController()
		const node = new AbortController()
		const calls: Array<string> = []
		controller.signal.onabort = () => calls.push("onabort")
		controller.signal.addEventListener("abort", () => calls.push("listener"), { once: true })
		controller.signal.addEventListener("abort", { handleEvent: () => calls.push("object") })
		controller.abort()
		controller.abort()
		node.abort()
		expect(calls).toEqual(["onabort", "listener", "object"])
		expect(controller.signal.aborted).toBe(true)
		expect((controller.signal.reason as Error).name).toBe((node.signal.reason as Error).name)
		expect(() => controller.signal.throwIfAborted()).toThrow()
	})

	test("a removed listener is not called; a given reason is kept", () => {
		const controller = new ShimAbortController()
		const listener = vi.fn()
		controller.signal.addEventListener("abort", listener)
		controller.signal.removeEventListener("abort", listener)
		controller.abort("why")
		expect(listener).not.toHaveBeenCalled()
		expect(controller.signal.reason).toBe("why")
	})

	test("abort, any and timeout", async () => {
		expect(ShimAbortSignal.abort(1).reason).toBe(1)
		const a = new ShimAbortController()
		const b = new ShimAbortController()
		const any = ShimAbortSignal.any([a.signal, b.signal])
		b.abort("b")
		expect(any.aborted).toBe(true)
		expect(any.reason).toBe("b")
		expect(ShimAbortSignal.any([ShimAbortSignal.abort("x")]).reason).toBe("x")
		const timeout = ShimAbortSignal.timeout(5)
		await new Promise((resolve) => setTimeout(resolve, 20))
		expect(timeout.aborted).toBe(true)
		expect((timeout.reason as Error).name).toBe("TimeoutError")
	})
})

describe("installRuntimeShims", () => {
	test("installs only what is missing", () => {
		const g = globalThis as Record<string, unknown>
		const saved = Object.fromEntries(Object.keys(RUNTIME_SHIMS).map((name) => [name, g[name]]))
		try {
			for (const name of ["URL", "AbortSignal"]) delete g[name]
			expect(installRuntimeShims()).toEqual(["URL", "AbortSignal"])
			expect(g.URL).toBe(ShimURL)
			expect(g.TextEncoder).toBe(saved.TextEncoder)
		} finally {
			Object.assign(g, saved)
		}
	})
})
