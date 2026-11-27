/**
 * The browser's platform services. The only place in the package that reads browser globals;
 * `Session` and `ClientDataConfig` come from the app (its auth and server choice).
 */
import { persistedCollectionOptions } from "@tanstack/browser-db-sqlite-persistence"
import type { WebSocketConstructor } from "@hazel/effect-db-collection"
import { Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { Connectivity, Ids, KeyValue, LocalCache, type PersistOptions, Sockets } from "../services"
import { bindLocalCache, channelSnapshots, forgetLocalCache, localCachePersistence } from "./local-cache"

export type { LocalCacheHost } from "./local-cache-host"

export const IdsWeb = Layer.succeed(Ids, { randomUUID: () => crypto.randomUUID() })

/** `localStorage`, ignoring a missing, full or blocked store. */
export const KeyValueWeb = Layer.succeed(KeyValue, {
	get: (key) => {
		try {
			return globalThis.localStorage?.getItem(key) ?? null
		} catch {
			return null
		}
	},
	set: (key, value) => {
		try {
			globalThis.localStorage?.setItem(key, value)
		} catch {}
	},
	remove: (key) => {
		try {
			globalThis.localStorage?.removeItem(key)
		} catch {}
	},
})

/** Reads `WebSocket` when a socket opens, as the hub did before, so a stubbed global applies. */
class WebSocketWeb {
	constructor(url: string, protocols: string | Array<string>) {
		return new globalThis.WebSocket(url, protocols)
	}
}

export const SocketsWeb = Layer.succeed(Sockets, {
	// SAFETY: `new WebSocketWeb` returns the DOM socket, a `WebSocketLike` with wider handler types.
	WebSocket: WebSocketWeb as WebSocketConstructor,
})

export const ConnectivityWeb = Layer.succeed(Connectivity, {
	subscribeOnline: (listener) => {
		if (typeof window === "undefined" || typeof window.addEventListener !== "function") return () => {}
		window.addEventListener("online", listener)
		return () => window.removeEventListener?.("online", listener)
	},
})

const persistWith =
	(persistence: NonNullable<typeof localCachePersistence>): PersistOptions =>
	(schemaVersion) =>
	(options) =>
		persistedCollectionOptions({
			...(options as typeof options & Parameters<typeof persistedCollectionOptions>[0]),
			persistence,
			schemaVersion,
		})

const persistWeb = localCachePersistence === undefined ? undefined : persistWith(localCachePersistence)

/** wa-sqlite on OPFS (or the native host's SQLite, `./local-cache-host.ts`), channel states in IndexedDB. */
export const LocalCacheWeb = Layer.succeed(LocalCache, {
	persist: persistWeb,
	snapshots: channelSnapshots?.store,
	bind: bindLocalCache,
	forget: forgetLocalCache,
})

/** `fetch`, sending the API's session cookie with cross-origin requests. */
export const HttpClientWeb = FetchHttpClient.layer.pipe(
	Layer.provide(Layer.succeed(FetchHttpClient.RequestInit, { credentials: "include" })),
)

/** Every web service but `Session` and `ClientDataConfig`. */
export const PlatformWeb = Layer.mergeAll(
	IdsWeb,
	KeyValueWeb,
	SocketsWeb,
	ConnectivityWeb,
	LocalCacheWeb,
	HttpClientWeb,
)

export {
	ClipboardWeb,
	FilesWeb,
	type FilesWebOptions,
	holdDroppedFiles,
	pickWithInput,
	putFile,
} from "./ui-services"
export { bindLocalCache, channelSnapshots, forgetLocalCache, localCachePersistence } from "./local-cache"
export * as ChannelSnapshotsWeb from "./channel-snapshots"
