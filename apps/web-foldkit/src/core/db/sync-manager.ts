/**
 * The connection manager: which sources the signed-in user holds open. `user:<me>` from the
 * session; `org:<id>` for each `user_organizations` row, plus the host org of every Connect
 * conversation the user can see (a guest gets a filtered socket to the host `OrgObject`, for the
 * host's users and the conversation rows). Channels open on demand (`channelPartition`).
 */
import { type MutableSourceSet, type SourceKey, sourceKey } from "@hazel/effect-db-collection"
import type { OrganizationId, UserId } from "@hazel/schema"
import { Effect, Stream } from "effect"
import { connectConversationCollection, userOrganizationCollection } from "./collections"
import { orgSources, syncHub, userSources } from "./sync"

/** The part of a TanStack collection the manager reads. */
export interface ObservedRows<Row> {
	readonly toArray: ReadonlyArray<Row>
	readonly isReady: () => boolean
	readonly onFirstReady: (callback: () => void) => void
	readonly subscribeChanges: (
		callback: () => void,
		options: { readonly includeInitialState: false },
	) => { readonly unsubscribe: () => void }
}

export interface SyncManagerDeps {
	readonly userSources: MutableSourceSet
	readonly orgSources: MutableSourceSet
	readonly userOrganizations: ObservedRows<{ readonly organizationId: OrganizationId }>
	readonly connectConversations: ObservedRows<{
		readonly hostOrganizationId: OrganizationId
		readonly deletedAt: unknown
	}>
}

const sameSources = (a: ReadonlyArray<SourceKey>, b: ReadonlyArray<SourceKey>) =>
	a.length === b.length && a.every((source, index) => source === b[index])

/** The org sources: the user's orgs and the Connect host orgs; unknown until the user's object synced. */
export const orgSourcesOf = (deps: SyncManagerDeps): ReadonlyArray<SourceKey> | undefined => {
	if (!deps.userOrganizations.isReady()) return undefined
	const ids = new Set<OrganizationId>(deps.userOrganizations.toArray.map((row) => row.organizationId))
	for (const conversation of deps.connectConversations.toArray) {
		if (conversation.deletedAt === null) ids.add(conversation.hostOrganizationId)
	}
	return [...ids].sort().map((id) => sourceKey("org", id))
}

/** Opens `userId`'s sources and keeps the org set current; returns the stop function. */
export const startSyncSession = (deps: SyncManagerDeps, userId: UserId): (() => void) => {
	let active = true
	const reconcile = () => {
		if (!active) return
		const next = orgSourcesOf(deps)
		if (next === undefined) return
		const current = deps.orgSources.get()
		if (current === undefined || !sameSources(current, next)) deps.orgSources.set(next)
	}
	deps.userSources.set([sourceKey("user", userId)])
	const subscriptions = [
		// Unfiltered, so leaving an org (a delete of a row older than the subscription) reconciles.
		deps.userOrganizations.subscribeChanges(reconcile, { includeInitialState: false }),
		deps.connectConversations.subscribeChanges(reconcile, { includeInitialState: false }),
	]
	deps.userOrganizations.onFirstReady(reconcile)
	reconcile()
	return () => {
		if (!active) return
		active = false
		for (const subscription of subscriptions) subscription.unsubscribe()
		deps.orgSources.set(undefined)
		deps.userSources.set(undefined)
	}
}

const appDeps: SyncManagerDeps = {
	userSources,
	orgSources,
	userOrganizations: userOrganizationCollection,
	connectConversations: connectConversationCollection,
}

/** The app's sources for `userId` while the stream runs (a root subscription keyed on the user). */
export const syncSession = (userId: UserId): Stream.Stream<never> =>
	Stream.callback<never>(() =>
		Effect.acquireRelease(
			Effect.sync(() => startSyncSession(appDeps, userId)),
			(stop) => Effect.sync(stop),
		).pipe(Effect.flatMap(() => Effect.never)),
	)

/** Sign-out: every connection closes and the synced rows go with them. */
export const closeSync = () => {
	userSources.set(undefined)
	orgSources.set(undefined)
	syncHub.close()
}
