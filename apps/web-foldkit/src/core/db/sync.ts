/**
 * The app's one sync hub (`infra/durable-object-sync-plan.md` §3) and the source sets the
 * collections follow. Sockets open `<VITE_BACKEND_URL>/sync/<kind>/<id>` with the access token;
 * a token a source refuses (4001) is invalidated so the next read exchanges again, and a refused
 * exchange dispatches `SESSION_REJECTED_EVENT` as before.
 */
import type { SourceKey, SourceSet } from "@hazel/effect-db-collection"
import { SyncHub, sourceSet } from "@hazel/effect-db-collection"
import { invalidateAccessToken, readAccessToken } from "~/lib/access-token"

const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:3003"

export const syncHub = new SyncHub({
	baseUrl: backendUrl,
	getToken: readAccessToken,
	invalidateToken: invalidateAccessToken,
})

/** `user:<me>`, set by the connection manager once `user.me` answered. */
export const userSources = sourceSet()

/** `org:<id>` for every org of the user and every Connect host org it is a guest of. */
export const orgSources = sourceSet()

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
