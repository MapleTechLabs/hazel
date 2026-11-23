/**
 * The Hazel install this page talks to: its web app, API, uploads and link-preview worker.
 *
 * In a browser it is the build's own (`VITE_*`, set per stage by `apps/web-foldkit/alchemy.run.ts`).
 * The native apps (desktop, iOS) default to it too, but can be pointed at another install, a
 * customer's (`docs/self-hosting.md`), chosen at runtime on the sign-in page: the address the user
 * types is resolved through that install's `/.well-known/hazel.json` (written by the web build,
 * `vite.config.ts`). The choice is fixed for the page's life: changing it reloads the app.
 */
import { Effect, Schema } from "effect"
import { desktopAuthClient } from "../../platform/desktop"
import { DISCOVERY_PATH, type Server, serverFromEnv } from "./discovery"

export type { Server } from "./discovery"

const trimSlashes = (url: string) => url.replace(/\/+$/, "")

/** The install this build was made for (`VITE_*`), read on each call so tests can stub it. */
export const buildServer = (): Server => serverFromEnv(import.meta.env)

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

/** https, or http on this machine only (a local stack). */
export const isAllowedUrl = (url: URL): boolean =>
	url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))

export type AddressProblem = "Empty" | "Invalid" | "Insecure"

/**
 * The origin an address the user typed names: `chat.acme.com`, `https://app.chat.acme.com/` or
 * `app.chat.acme.com/sign-in` all name an https origin. No scheme means https; http is refused
 * except on localhost; anything with credentials or another scheme is invalid.
 */
export const normalizeAddress = (
	input: string,
):
	| { readonly _tag: "Ok"; readonly origin: string }
	| { readonly _tag: "Problem"; readonly problem: AddressProblem } => {
	const trimmed = input.trim()
	if (trimmed === "") return { _tag: "Problem", problem: "Empty" }
	const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
	const candidate = hasScheme ? trimmed : `https://${trimmed}`
	if (!URL.canParse(candidate)) return { _tag: "Problem", problem: "Invalid" }
	const url = new URL(candidate)
	if (url.protocol !== "https:" && url.protocol !== "http:") return { _tag: "Problem", problem: "Invalid" }
	if (url.username !== "" || url.password !== "" || url.hostname === "") {
		return { _tag: "Problem", problem: "Invalid" }
	}
	// A bare word (`acme`) is a typo, not an install; localhost is the exception.
	if (!url.hostname.includes(".") && !LOCAL_HOSTS.has(url.hostname)) {
		return { _tag: "Problem", problem: "Invalid" }
	}
	if (!isAllowedUrl(url)) return { _tag: "Problem", problem: "Insecure" }
	return { _tag: "Ok", origin: url.origin }
}

/** `/.well-known/hazel.json`: the install's addresses (`vite.config.ts` writes it). */
export const DiscoveryDocument = Schema.Struct({
	app: Schema.String,
	api: Schema.String,
	cdn: Schema.optionalKey(Schema.NullOr(Schema.String)),
	linkPreview: Schema.optionalKey(Schema.NullOr(Schema.String)),
})
export type DiscoveryDocument = typeof DiscoveryDocument.Type

/** The build's addresses as its discovery document. */
export const discoveryDocumentOf = (server: Server): DiscoveryDocument => ({
	app: server.app,
	api: server.api,
	cdn: server.cdn,
	linkPreview: server.linkPreview,
})

const allowedBase = (value: string): string | null => {
	if (!URL.canParse(value)) return null
	const url = new URL(value)
	if (
		!isAllowedUrl(url) ||
		url.username !== "" ||
		url.password !== "" ||
		url.search !== "" ||
		url.hash !== ""
	) {
		return null
	}
	return trimSlashes(`${url.origin}${url.pathname}`)
}

/** A server from untrusted JSON (a discovery document, storage): every address must be https. */
export const parseServer = (input: unknown): Server | null => {
	const decoded = Schema.decodeUnknownOption(DiscoveryDocument)(input)
	if (decoded._tag === "None") return null
	const document = decoded.value
	const app = allowedBase(document.app)
	const api = allowedBase(document.api)
	if (app === null || api === null) return null
	const optional = (value: string | null | undefined): string | null | undefined =>
		value === null || value === undefined ? null : (allowedBase(value) ?? undefined)
	const cdn = optional(document.cdn)
	const linkPreview = optional(document.linkPreview)
	if (cdn === undefined || linkPreview === undefined) return null
	return { app: new URL(app).origin, api, cdn, linkPreview }
}

export const sameServer = (a: Server, b: Server): boolean => a.app === b.app && a.api === b.api

/** Why an address could not be resolved to an install. */
export class ServerDiscoveryError extends Schema.TaggedError<
	ServerDiscoveryError,
	{ readonly brand: unique symbol }
>()("ServerDiscoveryError", {
	reason: Schema.Literals(["Empty", "Invalid", "Insecure", "Unreachable", "NotHazel"]),
}) {}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

/** The discovery document at `origin`, or `null` when there is none (or it isn't Hazel's). */
const fetchDocument = (origin: string, fetchImpl: Fetch) =>
	Effect.tryPromise({
		try: async (signal) => {
			const response = await fetchImpl(`${origin}${DISCOVERY_PATH}`, {
				signal,
				credentials: "omit",
				headers: { accept: "application/json" },
			})
			if (!response.ok) return { _tag: "NotHazel" as const }
			// The SPA answers unknown paths with its shell: not JSON, so not an install's document.
			const body: unknown = await response.json().catch(() => undefined)
			const server = parseServer(body)
			return server === null ? { _tag: "NotHazel" as const } : { _tag: "Found" as const, server }
		},
		catch: () => new ServerDiscoveryError({ reason: "Unreachable" }),
	}).pipe(
		Effect.timeoutOrElse({
			duration: "10 seconds",
			orElse: () => Effect.fail(new ServerDiscoveryError({ reason: "Unreachable" })),
		}),
	)

/**
 * Resolves an address the user typed to an install: its discovery document at that origin, or at
 * `app.<host>` (a customer install's web app, when the user typed the zone, `chat.acme.com`).
 */
export const discoverServer = (
	input: string,
	fetchImpl: Fetch = (url, init) => globalThis.fetch(url, init),
): Effect.Effect<Server, ServerDiscoveryError> =>
	Effect.gen(function* () {
		const address = normalizeAddress(input)
		if (address._tag === "Problem") return yield* new ServerDiscoveryError({ reason: address.problem })
		const url = new URL(address.origin)
		const candidates = [
			address.origin,
			...(url.hostname.startsWith("app.") || LOCAL_HOSTS.has(url.hostname)
				? []
				: [`${url.protocol}//app.${url.host}`]),
		]
		let unreachable = false
		for (const origin of candidates) {
			const found = yield* fetchDocument(origin, fetchImpl).pipe(
				Effect.catchTag("ServerDiscoveryError", () =>
					Effect.sync(() => {
						unreachable = true
						return { _tag: "NotHazel" as const }
					}),
				),
			)
			if (found._tag === "Found") return found.server
		}
		return yield* new ServerDiscoveryError({ reason: unreachable ? "Unreachable" : "NotHazel" })
	})

/** Where the desktop app keeps its choice (the page's own storage, on disk in the app). */
export const STORAGE_KEY = "hazel:server"

export interface ServerStorage {
	readonly getItem: (key: string) => string | null
	readonly setItem: (key: string, value: string) => void
	readonly removeItem: (key: string) => void
}

/**
 * The chosen install: the one the iOS shell hands the page (`window.__hazelServer`, kept by the
 * shell), else the one stored here (desktop), else the build's. A malformed value is ignored.
 */
export const loadServer = (options: {
	readonly injected: unknown
	readonly storage: ServerStorage | undefined
	readonly fallback: Server
}): Server => {
	if (options.injected !== undefined && options.injected !== null) {
		const injected = parseServer(options.injected)
		if (injected !== null) return injected
	}
	try {
		const stored = options.storage?.getItem(STORAGE_KEY)
		if (stored !== null && stored !== undefined) {
			const parsed = parseServer(JSON.parse(stored))
			if (parsed !== null) return parsed
		}
	} catch {
		// Unreadable storage or JSON: the build's install.
	}
	return options.fallback
}

/** Keeps the choice; `null` (or the build's own install) goes back to the default. */
export const storeServer = (storage: ServerStorage, server: Server | null, fallback: Server): void => {
	if (server === null || sameServer(server, fallback)) storage.removeItem(STORAGE_KEY)
	else storage.setItem(STORAGE_KEY, JSON.stringify(discoveryDocumentOf(server)))
}

/** Whether this build can talk to another install: the native apps, never the browser. */
export const canChooseServer = (): boolean => desktopAuthClient !== null

declare global {
	interface Window {
		/** The install the iOS shell loaded this page for (`WebBridge.loadPage`). */
		__hazelServer?: unknown
	}
}

const localStorageOrUndefined = (): ServerStorage | undefined => {
	try {
		return typeof localStorage === "undefined" ? undefined : localStorage
	} catch {
		return undefined
	}
}

let chosen: Server | undefined

/** The install this page talks to (see {@link Server}). */
export const currentServer = (): Server => {
	if (!canChooseServer()) return buildServer()
	chosen ??= loadServer({
		injected: typeof window === "undefined" ? undefined : window.__hazelServer,
		storage: localStorageOrUndefined(),
		fallback: buildServer(),
	})
	return chosen
}

/** Whether the page talks to the build's own install (Hazel's, for the store builds). */
export const isBuildServer = (server: Server = currentServer()): boolean => sameServer(server, buildServer())

/** The API's base URL of {@link currentServer}. */
export const apiUrl = (): string => currentServer().api

/** The web app's origin of {@link currentServer}. */
export const appOrigin = (): string => currentServer().app

/** How an install is named on screen: its web app's host, without the `app.` prefix. */
export const serverLabel = (server: Server): string => new URL(server.app).host.replace(/^app\./, "")
