/**
 * The app's one sync hub (`infra/durable-object-sync-plan.md` §3) and the source sets the
 * collections follow. Every source streams over one socket, `<VITE_BACKEND_URL>/sync/mux`, each
 * opened with the access token; a token a source refuses (4001) is invalidated so the next read
 * exchanges again, and a refused exchange dispatches `SESSION_REJECTED_EVENT` as before.
 */
import type { SourceKey, SourceSet } from "@hazel/effect-db-collection"
import { SyncHub, type SyncHubConfig, sourceSet } from "@hazel/effect-db-collection"
import { invalidateAccessToken, readAccessToken } from "~/lib/access-token"
import { channelSnapshots } from "./local-cache"

const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:3003"

const hubConfig: SyncHubConfig = {
	baseUrl: backendUrl,
	getToken: readAccessToken,
	invalidateToken: invalidateAccessToken,
	// One socket for every source: a browser opens WebSockets to a host one handshake at a time,
	// so a socket per org made a load wait one handshake per org, in turn.
	multiplex: true,
	// Going back to a channel within this keeps its rows and live stream: no new snapshot.
	releaseGraceMs: 3 * 60_000,
}

export const syncHub = new SyncHub(
	// A channel opened again later shows its last state while its source answers.
	channelSnapshots === undefined ? hubConfig : { ...hubConfig, snapshots: channelSnapshots.store },
)

/** `user:<me>`, set by the connection manager once `user.me` answered. */
export const userSources = sourceSet()

/** `org:<id>` for every org of the user and every Connect host org it is a guest of. */
export const orgSources = sourceSet()

/**
 * `customers:<organizationId>`: the org whose Customers area the user opened. Set when the area is
 * first entered (`openCustomersSource`) and kept for the session, so going back is instant; unknown
 * (its collections load) until then.
 */
export const customersSources = sourceSet()

export const openCustomersSource = (organizationId: string) => {
	const key: SourceKey = `customers:${organizationId}`
	if (customersSources.get()?.[0] !== key) customersSources.set([key])
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

/** The channels whose sources are open now: the rows message search can see. */
export const openChannelIds = (): ReadonlySet<string> => {
	const ids = new Set<string>()
	for (const source of syncHub.statuses().keys()) {
		if (source.startsWith("channel:")) ids.add(source.slice("channel:".length))
	}
	return ids
}
