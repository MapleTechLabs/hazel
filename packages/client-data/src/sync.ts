/**
 * The client's one sync hub (`infra/durable-object-sync-plan.md` §3) and the source sets the
 * collections follow. Every source streams over one socket, `<api>/sync/mux`, each
 * opened with the access token; a token a source refuses (4001) is invalidated so the next read
 * exchanges again, and a refused exchange dispatches `SESSION_REJECTED_EVENT` as before.
 */
import type { SourceKey, SourceSet, SourceSnapshotStore, SyncTokenResult } from "@hazel/effect-db-collection"
import {
	SyncHub,
	type SyncHubConfig,
	sourceSet,
	type WebSocketConstructor,
} from "@hazel/effect-db-collection"

export interface SyncDeps {
	readonly baseUrl: string
	readonly getToken: () => Promise<SyncTokenResult>
	readonly invalidateToken: (token: string) => void
	readonly WebSocket: WebSocketConstructor
	readonly subscribeOnline: (listener: () => void) => () => void
	readonly snapshots: SourceSnapshotStore | undefined
}

/** Every source in `sets`; unknown while any of them is. */
export const unionSources = (...sets: ReadonlyArray<SourceSet>): SourceSet => ({
	get: () => {
		const all: Array<SourceKey> = []
		for (const set of sets) {
			const sources = set.get()
			if (sources === undefined) return undefined
			all.push(...sources)
		}
		return [...new Set(all)]
	},
	subscribe: (listener) => {
		const unsubscribes = sets.map((set) => set.subscribe(listener))
		return () => {
			for (const unsubscribe of unsubscribes) unsubscribe()
		}
	},
})

export const makeSync = (deps: SyncDeps) => {
	const hubConfig: SyncHubConfig = {
		baseUrl: deps.baseUrl,
		getToken: deps.getToken,
		invalidateToken: deps.invalidateToken,
		WebSocket: deps.WebSocket,
		subscribeOnline: deps.subscribeOnline,
		// One socket for every source: a browser opens WebSockets to a host one handshake at a time,
		// so a socket per org made a load wait one handshake per org, in turn.
		multiplex: true,
		// Going back to a channel within this keeps its rows and live stream: no new snapshot.
		releaseGraceMs: 3 * 60_000,
	}

	// A channel opened again later shows its last state while its source answers.
	const syncHub = new SyncHub(
		deps.snapshots === undefined ? hubConfig : { ...hubConfig, snapshots: deps.snapshots },
	)

	/** `user:<me>`, set by the connection manager once `user.me` answered. */
	const userSources = sourceSet()

	/** `org:<id>` for every org of the user and every Connect host org it is a guest of. */
	const orgSources = sourceSet()

	/**
	 * `customers:<organizationId>`: the org whose Customers area the user opened. Set when the area is
	 * first entered (`openCustomersSource`) and kept for the session, so going back is instant; unknown
	 * (its collections load) until then.
	 */
	const customersSources = sourceSet()

	const openCustomersSource = (organizationId: string) => {
		const key: SourceKey = `customers:${organizationId}`
		if (customersSources.get()?.[0] !== key) customersSources.set([key])
	}

	/** The channels whose sources are open now: the rows message search can see. */
	const openChannelIds = (): ReadonlySet<string> => {
		const ids = new Set<string>()
		for (const source of syncHub.statuses().keys()) {
			if (source.startsWith("channel:")) ids.add(source.slice("channel:".length))
		}
		return ids
	}

	return { syncHub, userSources, orgSources, customersSources, openCustomersSource, openChannelIds }
}

export type Sync = ReturnType<typeof makeSync>
