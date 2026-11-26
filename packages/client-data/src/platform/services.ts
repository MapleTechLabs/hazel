/**
 * The platform services: every host API the data layer touches. Each host (the browser, an iOS
 * JavaScriptCore runtime, a test) provides them as Layers; nothing else in the package reaches a global.
 *
 * Beyond them the package (and Effect, TanStack DB) assumes only the JS runtime baseline in
 * `./runtime-baseline.ts`: timers, `queueMicrotask` and `console`, which a bare JSContext lacks.
 */
import type { SourceSnapshotStore, SyncTokenResult, WebSocketConstructor } from "@hazel/effect-db-collection"
import type { SessionLoadError } from "@hazel/domain/errors"
import type { UserId } from "@hazel/schema"
import { Context, type Effect } from "effect"

/** Random ids for optimistic rows (`crypto.randomUUID` on the web). */
export class Ids extends Context.Service<
	Ids,
	{
		readonly randomUUID: () => string
	}
>()("@hazel/client-data/Ids") {}

/** A small synchronous string store (`localStorage` on the web). Failures read as "nothing stored". */
export class KeyValue extends Context.Service<
	KeyValue,
	{
		readonly get: (key: string) => string | null
		readonly set: (key: string, value: string) => void
		readonly remove: (key: string) => void
	}
>()("@hazel/client-data/KeyValue") {}

/** The sync sockets (`WebSocket` on the web). */
export class Sockets extends Context.Service<
	Sockets,
	{
		readonly WebSocket: WebSocketConstructor
	}
>()("@hazel/client-data/Sockets") {}

/** Network signals: `subscribeOnline` calls back when the network comes back (`online` on the web). */
export class Connectivity extends Context.Service<
	Connectivity,
	{
		readonly subscribeOnline: (listener: () => void) => () => void
	}
>()("@hazel/client-data/Connectivity") {}

/**
 * Auth and session: the sync sockets' access token, and the RPC `authorization` header
 * (`null` sends none; the web's cookie session needs none, the desktop app sends its bearer).
 */
export class Session extends Context.Service<
	Session,
	{
		readonly getAccessToken: () => Promise<SyncTokenResult>
		readonly invalidateAccessToken: (token: string) => void
		readonly authorization: Effect.Effect<string | null, SessionLoadError>
	}
>()("@hazel/client-data/Session") {}

/** A collection's persisted options, for a host whose cache is on. */
export type PersistOptions = (schemaVersion: number) => <O extends object>(options: O) => object

/**
 * The local cache (`./web/local-cache.ts` on the web: wa-sqlite on OPFS, channel states in
 * IndexedDB). `persist` and `snapshots` are `undefined` while the cache is off.
 */
export class LocalCache extends Context.Service<
	LocalCache,
	{
		readonly persist: PersistOptions | undefined
		readonly snapshots: SourceSnapshotStore | undefined
		/** Opens `userId`'s cache; the persisted collections start syncing then. */
		readonly bind: (userId: UserId) => void
		/** The session ended: deletes what is kept. Whether a file was open (the page must load again). */
		readonly forget: (userId?: UserId) => Promise<boolean>
	}
>()("@hazel/client-data/LocalCache") {}

/** Where the api lives, and the app's retry policy for message sends. */
export class ClientDataConfig extends Context.Service<
	ClientDataConfig,
	{
		readonly apiUrl: string
		// BOUNDARY: any failure a send can end in; the app's classifier parses it.
		readonly isRetryableError: (error: unknown) => boolean
	}
>()("@hazel/client-data/ClientDataConfig") {}
