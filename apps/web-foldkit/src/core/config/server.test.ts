import { Effect, Exit } from "effect"
import { describe, expect, test } from "vitest"
import {
	discoverServer,
	loadServer,
	normalizeAddress,
	parseServer,
	type Server,
	type ServerStorage,
	STORAGE_KEY,
	storeServer,
} from "./server"

const hazel: Server = {
	app: "https://app.hazel.sh",
	api: "https://api.hazel.sh",
	cdn: "https://cdn.hazel.sh",
	linkPreview: null,
}

const acme: Server = {
	app: "https://app.chat.acme.com",
	api: "https://api.chat.acme.com",
	cdn: "https://cdn.chat.acme.com",
	linkPreview: "https://link-preview.chat.acme.com",
}

const memoryStorage = (initial: Record<string, string> = {}) => {
	const values = new Map(Object.entries(initial))
	const storage: ServerStorage = {
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => void values.set(key, value),
		removeItem: (key) => void values.delete(key),
	}
	return { storage, values }
}

describe("normalizeAddress", () => {
	test.each([
		["chat.acme.com", "https://chat.acme.com"],
		["  app.chat.acme.com  ", "https://app.chat.acme.com"],
		["https://app.chat.acme.com/", "https://app.chat.acme.com"],
		["https://app.chat.acme.com/sign-in?x=1", "https://app.chat.acme.com"],
		["HTTPS://App.Chat.Acme.com", "https://app.chat.acme.com"],
		["chat.acme.com:8443", "https://chat.acme.com:8443"],
		["http://localhost:3100", "http://localhost:3100"],
		["localhost:3100", "https://localhost:3100"],
	])("%s names %s", (input, origin) => {
		expect(normalizeAddress(input)).toEqual({ _tag: "Ok", origin })
	})

	test.each([
		["", "Empty"],
		["   ", "Empty"],
		["http://chat.acme.com", "Insecure"],
		["http://192.168.1.4", "Insecure"],
		["ftp://chat.acme.com", "Invalid"],
		["javascript://alert(1)", "Invalid"],
		["https://user:pass@chat.acme.com", "Invalid"],
		["acme", "Invalid"],
		["https://", "Invalid"],
		["not a url at all", "Invalid"],
	])("%j is refused (%s)", (input, problem) => {
		expect(normalizeAddress(input)).toEqual({ _tag: "Problem", problem })
	})
})

describe("parseServer", () => {
	test("takes a discovery document, keeping origins and base paths", () => {
		expect(
			parseServer({
				app: "https://app.chat.acme.com/",
				api: "https://api.chat.acme.com",
				cdn: "https://cdn.chat.acme.com/",
				linkPreview: "https://link-preview.chat.acme.com",
			}),
		).toEqual(acme)
	})

	test("the optional addresses may be missing or null", () => {
		expect(parseServer({ app: acme.app, api: acme.api })).toEqual({
			app: acme.app,
			api: acme.api,
			cdn: null,
			linkPreview: null,
		})
		expect(parseServer({ app: acme.app, api: acme.api, cdn: null })?.cdn).toBeNull()
	})

	test.each([
		["not an object", "hazel"],
		["no api", { app: acme.app }],
		["http api", { app: acme.app, api: "http://api.chat.acme.com" }],
		["http app", { app: "http://app.chat.acme.com", api: acme.api }],
		["javascript app", { app: "javascript:alert(1)", api: acme.api }],
		["credentials", { app: acme.app, api: "https://u:p@api.chat.acme.com" }],
		["query", { app: acme.app, api: "https://api.chat.acme.com?x=1" }],
		["insecure cdn", { app: acme.app, api: acme.api, cdn: "http://cdn.chat.acme.com" }],
		["wrong type", { app: acme.app, api: 42 }],
	])("refuses %s", (_name, input) => {
		expect(parseServer(input)).toBeNull()
	})

	test("a local stack may use http", () => {
		expect(parseServer({ app: "http://localhost:3100", api: "http://localhost:3003" })?.api).toBe(
			"http://localhost:3003",
		)
	})
})

describe("discoverServer", () => {
	const json = (body: unknown, status = 200) =>
		Promise.resolve(new Response(JSON.stringify(body), { status }))

	const run = (input: string, fetchImpl: (url: string) => Promise<Response>) =>
		Effect.runPromiseExit(discoverServer(input, fetchImpl))

	const reasonOf = (exit: Exit.Exit<Server, { readonly reason: string }>) =>
		Exit.isFailure(exit) && exit.cause.reasons[0]?._tag === "Fail"
			? exit.cause.reasons[0].error.reason
			: null

	test("reads the document at the address the user typed", async () => {
		const asked: Array<string> = []
		const exit = await run("app.chat.acme.com", (url) => {
			asked.push(url)
			return json(acme)
		})
		expect(exit).toEqual(Exit.succeed(acme))
		expect(asked).toEqual(["https://app.chat.acme.com/.well-known/hazel.json"])
	})

	test("the zone the user typed falls back to its app. host", async () => {
		const asked: Array<string> = []
		const exit = await run("chat.acme.com", (url) => {
			asked.push(url)
			return url.startsWith("https://app.")
				? json(acme)
				: Promise.resolve(new Response("", { status: 404 }))
		})
		expect(exit).toEqual(Exit.succeed(acme))
		expect(asked).toEqual([
			"https://chat.acme.com/.well-known/hazel.json",
			"https://app.chat.acme.com/.well-known/hazel.json",
		])
	})

	test("an SPA shell (HTML) is not an install", async () => {
		const exit = await run("app.example.com", () =>
			Promise.resolve(new Response("<!doctype html>", { status: 200 })),
		)
		expect(reasonOf(exit)).toBe("NotHazel")
	})

	test("a document naming an http API is not taken", async () => {
		const exit = await run("app.example.com", () =>
			json({ app: acme.app, api: "http://api.example.com" }),
		)
		expect(reasonOf(exit)).toBe("NotHazel")
	})

	test("a host that does not answer is unreachable", async () => {
		const exit = await run("chat.acme.com", () => Promise.reject(new TypeError("Failed to fetch")))
		expect(reasonOf(exit)).toBe("Unreachable")
	})

	test("an insecure or malformed address is refused before any request", async () => {
		let asked = 0
		const fetchImpl = () => {
			asked += 1
			return json(acme)
		}
		expect(reasonOf(await run("http://chat.acme.com", fetchImpl))).toBe("Insecure")
		expect(reasonOf(await run("", fetchImpl))).toBe("Empty")
		expect(reasonOf(await run("acme", fetchImpl))).toBe("Invalid")
		expect(asked).toBe(0)
	})
})

describe("persistence", () => {
	test("a stored install is loaded; storing the default (or null) resets it", () => {
		const { storage, values } = memoryStorage()
		expect(loadServer({ injected: undefined, storage, fallback: hazel })).toEqual(hazel)

		storeServer(storage, acme, hazel)
		expect(JSON.parse(values.get(STORAGE_KEY) ?? "null")).toEqual(acme)
		expect(loadServer({ injected: undefined, storage, fallback: hazel })).toEqual(acme)

		storeServer(storage, null, hazel)
		expect(values.has(STORAGE_KEY)).toBe(false)
		expect(loadServer({ injected: undefined, storage, fallback: hazel })).toEqual(hazel)

		storeServer(storage, acme, hazel)
		storeServer(storage, hazel, hazel)
		expect(values.has(STORAGE_KEY)).toBe(false)
	})

	test("the iOS shell's install comes first", () => {
		const { storage } = memoryStorage({ [STORAGE_KEY]: JSON.stringify(hazel) })
		expect(loadServer({ injected: acme, storage, fallback: hazel })).toEqual(acme)
	})

	test("malformed or insecure stored values fall back to the build's install", () => {
		for (const stored of ["{", "null", JSON.stringify({ app: "http://evil.example", api: acme.api })]) {
			const { storage } = memoryStorage({ [STORAGE_KEY]: stored })
			expect(loadServer({ injected: { app: "nope" }, storage, fallback: hazel })).toEqual(hazel)
		}
	})

	test("storage that throws falls back to the build's install", () => {
		const storage: ServerStorage = {
			getItem: () => {
				throw new Error("denied")
			},
			setItem: () => {},
			removeItem: () => {},
		}
		expect(loadServer({ injected: undefined, storage, fallback: hazel })).toEqual(hazel)
	})
})
