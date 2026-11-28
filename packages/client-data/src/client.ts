/**
 * One client's data layer: the sync hub and its source sets, the collections, the optimistic
 * actions and live queries, built from the platform services. A host builds one instance and
 * shares it (the web app, its islands); a test or an iOS runtime builds its own.
 */
import type { UserId } from "@hazel/schema"
import { Context, Effect, Layer, Stream } from "effect"
import { makeActions } from "./actions"
import { makeCollections } from "./collections"
import { liveQueryStream, retainChannels, retainChannelsSettled, watchStall } from "./live-query"
import {
	ClientDataConfig,
	Connectivity,
	Ids,
	KeyValue,
	LocalCache,
	Session,
	Sockets,
} from "./platform/services"
import { makeRoutingHints } from "./routing-hints"
import { makeSync } from "./sync"
import {
	forgetRememberedOrganizationsIn,
	orgSourcesSettled,
	rememberedOrganizationIdsIn,
	rememberedOrgSourcesIn,
	startSyncSession,
	type SyncManagerDeps,
} from "./sync-manager"

export class ClientData extends Context.Service<ClientData>()("@hazel/client-data/ClientData", {
	make: Effect.gen(function* () {
		const config = yield* ClientDataConfig
		const ids = yield* Ids
		const keyValue = yield* KeyValue
		const sockets = yield* Sockets
		const connectivity = yield* Connectivity
		const session = yield* Session
		const localCache = yield* LocalCache

		const sync = makeSync({
			baseUrl: config.apiUrl,
			getToken: session.getAccessToken,
			invalidateToken: session.invalidateAccessToken,
			WebSocket: sockets.WebSocket,
			subscribeOnline: connectivity.subscribeOnline,
			snapshots: localCache.snapshots,
		})
		const collections = makeCollections({ sync, persist: localCache.persist })
		const hints = makeRoutingHints(collections)
		const actions = makeActions({
			collections,
			hints,
			randomUUID: ids.randomUUID,
			isRetryableError: config.isRetryableError,
		})

		const rememberedOrgSources = rememberedOrgSourcesIn(keyValue)
		const managerDeps: SyncManagerDeps = {
			userSources: sync.userSources,
			orgSources: sync.orgSources,
			userOrganizations: collections.userOrganizationCollection,
			connectConversations: collections.connectConversationCollection,
			rememberedOrgSources,
		}

		/** `userId`'s sources while the stream runs (a root subscription keyed on the user). */
		const syncSession = (userId: UserId): Stream.Stream<never> =>
			Stream.callback<never>(() =>
				Effect.acquireRelease(
					Effect.sync(() => {
						localCache.bind(userId)
						return startSyncSession(managerDeps, userId)
					}),
					(stop) => Effect.sync(stop),
				).pipe(Effect.flatMap(() => Effect.never)),
			)

		/** Sign-out: every connection closes and the synced rows go with them. */
		const closeSync = () => {
			sync.userSources.set(undefined)
			sync.orgSources.set(undefined)
			sync.syncHub.close()
		}

		return {
			...sync,
			collections,
			hints,
			actions,
			syncSession,
			closeSync,
			/** `orgSourcesSettled` over this client's collections and hub. */
			orgSourcesSettled: orgSourcesSettled({
				...managerDeps,
				userOrganizationsStatus: collections.userOrganizationCollection,
				hub: sync.syncHub,
			}),
			rememberedOrganizationIds: (userId: UserId) =>
				rememberedOrganizationIdsIn(rememberedOrgSources, userId),
			forgetRememberedOrganizations: (userId: UserId) =>
				forgetRememberedOrganizationsIn(keyValue, userId),
			bindLocalCache: localCache.bind,
			forgetLocalCache: localCache.forget,
			liveQueryStream,
			watchStall,
			retainChannels: (channelIds: ReadonlyArray<string>) => retainChannels(sync.syncHub, channelIds),
			retainChannelsSettled: (channelIds: ReadonlyArray<string>) =>
				retainChannelsSettled(sync.syncHub, channelIds),
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
