/**
 * The connection manager: which sources the signed-in user holds open. `user:<me>` from the
 * session; `org:<id>` for each `user_organizations` row, plus the host org of every Connect
 * conversation the user can see (a guest gets a filtered socket to the host `OrgObject`, for the
 * host's users and the conversation rows). Channels open on demand (`channelPartition`).
 *
 * The org set is remembered per user, so the next load opens those orgs beside the user's object
 * instead of after its snapshot. A remembered org the user has left refuses its socket (4003),
 * which drops its rows, and the user's object then sets the real set.
 */
import {
	type MutableSourceSet,
	type SourceKey,
	type SourceSet,
	type SyncHub,
	sourceKey,
} from "@hazel/effect-db-collection"
import type { Collection } from "@tanstack/db"
import type { EmptyHold } from "../../data/live-query"
import type { OrganizationId, UserId } from "@hazel/schema"
import { Effect, Stream } from "effect"
import { connectConversationCollection, userOrganizationCollection } from "./collections"
import { bindLocalCache } from "./local-cache"
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
	/** The org set last seen for a user; the next load opens it before the user's object answers. */
	readonly rememberedOrgSources?: RememberedOrgSources
}

export interface RememberedOrgSources {
	readonly read: (userId: UserId) => ReadonlyArray<SourceKey> | undefined
	readonly write: (userId: UserId, sources: ReadonlyArray<SourceKey>) => void
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

/**
 * The org sources are known and have answered: `user_organizations` has loaded, and every org
 * source in the set has its snapshot (or refused). Until then a query over them may lack an org
 * the user just joined: its source is a guess or still connecting.
 */
export const orgSourcesSettled = (deps: {
	readonly userOrganizations: Pick<Collection<any, any>, "isReady" | "on">
	readonly orgSources: SourceSet
	readonly hub: Pick<SyncHub, "connectionOf" | "subscribeStatus">
}): EmptyHold => ({
	isSettled: () =>
		deps.userOrganizations.isReady() &&
		(deps.orgSources.get() ?? []).every((source) => deps.hub.connectionOf(source)?.isSettled === true),
	subscribe: (onChange) => {
		const unsubscribes = [
			deps.userOrganizations.on("status:change", onChange),
			deps.orgSources.subscribe(onChange),
			deps.hub.subscribeStatus(onChange),
		]
		return () => {
			for (const unsubscribe of unsubscribes) unsubscribe()
		}
	},
})

/** Opens `userId`'s sources and keeps the org set current; returns the stop function. */
export const startSyncSession = (deps: SyncManagerDeps, userId: UserId): (() => void) => {
	let active = true
	const reconcile = () => {
		if (!active) return
		const next = orgSourcesOf(deps)
		if (next === undefined) return
		const current = deps.orgSources.get()
		if (current === undefined || !sameSources(current, next)) {
			deps.orgSources.set(next)
			deps.rememberedOrgSources?.write(userId, next)
		}
	}
	deps.userSources.set([sourceKey("user", userId)])
	const remembered = deps.rememberedOrgSources?.read(userId)
	if (remembered !== undefined && remembered.length > 0) deps.orgSources.set(remembered)
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

const rememberedKey = (userId: UserId) => `hazel:org-sources:${userId}`

/** `localStorage`, ignoring a missing, full or blocked store: remembering only saves time. */
const localRememberedOrgSources: RememberedOrgSources = {
	read: (userId) => {
		try {
			const stored: unknown = JSON.parse(
				globalThis.localStorage?.getItem(rememberedKey(userId)) ?? "null",
			)
			return Array.isArray(stored) &&
				stored.every((key) => typeof key === "string" && key.startsWith("org:"))
				? (stored as Array<SourceKey>)
				: undefined
		} catch {
			return undefined
		}
	},
	write: (userId, sources) => {
		try {
			globalThis.localStorage?.setItem(rememberedKey(userId), JSON.stringify(sources))
		} catch {}
	},
}

const appDeps: SyncManagerDeps = {
	userSources,
	orgSources,
	userOrganizations: userOrganizationCollection,
	connectConversations: connectConversationCollection,
	rememberedOrgSources: localRememberedOrgSources,
}

/** The app's sources for `userId` while the stream runs (a root subscription keyed on the user). */
export const syncSession = (userId: UserId): Stream.Stream<never> =>
	Stream.callback<never>(() =>
		Effect.acquireRelease(
			Effect.sync(() => {
				bindLocalCache(userId)
				return startSyncSession(appDeps, userId)
			}),
			(stop) => Effect.sync(stop),
		).pipe(Effect.flatMap(() => Effect.never)),
	)

/** `orgSourcesSettled` over the app's collections and hub. */
export const appOrgSourcesSettled = orgSourcesSettled({
	userOrganizations: userOrganizationCollection,
	orgSources,
	hub: syncHub,
})

/** Sign-out: every connection closes and the synced rows go with them. */
export const closeSync = () => {
	userSources.set(undefined)
	orgSources.set(undefined)
	syncHub.close()
}
