import { Persistence } from "effect/persistence"
import type { UserId } from "@hazel/schema"
import { Context, Duration, Effect, Exit, Layer, Metric, Option } from "effect"
import { UserLookupCacheError } from "../errors.ts"
import { userLookupCacheHits, userLookupCacheMisses, userLookupCacheOperationLatency } from "../metrics.ts"
import { UserLookupCacheRequest, type UserLookupResult } from "./user-lookup-request.ts"

export const USER_LOOKUP_CACHE_PREFIX = "auth:user-lookup"
export const USER_LOOKUP_CACHE_TTL = Duration.minutes(5)

/**
 * User lookup cache service using Persistence.
 * Caches the mapping from externalId (Clerk user ID) → internal UserId.
 */
export class UserLookupCache extends Context.Service<UserLookupCache>()("@hazel/auth/UserLookupCache", {
	make: Effect.gen(function* () {
		const persistence = yield* Persistence.Persistence

		const store = yield* persistence.make({
			storeId: USER_LOOKUP_CACHE_PREFIX,
			timeToLive: () => USER_LOOKUP_CACHE_TTL,
		})

		const get = (
			externalId: string,
		): Effect.Effect<Option.Option<UserLookupResult>, UserLookupCacheError> =>
			Effect.gen(function* () {
				const startTime = Date.now()

				yield* Effect.annotateCurrentSpan("cache.system", "redis")
				yield* Effect.annotateCurrentSpan("cache.name", USER_LOOKUP_CACHE_PREFIX)
				yield* Effect.annotateCurrentSpan("cache.operation", "get")

				const request = new UserLookupCacheRequest({ externalId })

				const cached = yield* store.get(request).pipe(
					Effect.mapError(
						(e) =>
							new UserLookupCacheError({
								message: "Failed to get user lookup from cache",
								cause: e,
							}),
					),
				)

				yield* Metric.update(userLookupCacheOperationLatency, Date.now() - startTime)

				if (cached === undefined) {
					yield* Metric.update(userLookupCacheMisses, 1)
					yield* Effect.annotateCurrentSpan("cache.result", "miss")
					return Option.none<UserLookupResult>()
				}

				if (Exit.isSuccess(cached)) {
					yield* Metric.update(userLookupCacheHits, 1)
					yield* Effect.annotateCurrentSpan("cache.result", "hit")
					return Option.some(cached.value)
				}

				yield* Metric.update(userLookupCacheMisses, 1)
				yield* Effect.annotateCurrentSpan("cache.result", "miss")
				yield* Effect.annotateCurrentSpan("cache.skip_reason", "failure_cached")
				return Option.none<UserLookupResult>()
			}).pipe(Effect.withSpan("UserLookupCache.get"))

		const set = (externalId: string, internalUserId: UserId): Effect.Effect<void, UserLookupCacheError> =>
			Effect.gen(function* () {
				const startTime = Date.now()

				yield* Effect.annotateCurrentSpan("cache.system", "redis")
				yield* Effect.annotateCurrentSpan("cache.name", USER_LOOKUP_CACHE_PREFIX)
				yield* Effect.annotateCurrentSpan("cache.operation", "set")

				const request = new UserLookupCacheRequest({ externalId })
				const result: UserLookupResult = { internalUserId }

				yield* store.set(request, Exit.succeed(result)).pipe(
					Effect.mapError(
						(e) =>
							new UserLookupCacheError({
								message: "Failed to set user lookup in cache",
								cause: e,
							}),
					),
				)

				yield* Metric.update(userLookupCacheOperationLatency, Date.now() - startTime)
				yield* Effect.annotateCurrentSpan(
					"cache.item.ttl_ms",
					Duration.toMillis(USER_LOOKUP_CACHE_TTL),
				)

				yield* Effect.logDebug(`Cached user lookup: ${externalId} -> ${internalUserId}`)
			}).pipe(Effect.withSpan("UserLookupCache.set"))

		const invalidate = (externalId: string): Effect.Effect<void, UserLookupCacheError> =>
			Effect.gen(function* () {
				yield* Effect.annotateCurrentSpan("cache.system", "redis")
				yield* Effect.annotateCurrentSpan("cache.name", USER_LOOKUP_CACHE_PREFIX)
				yield* Effect.annotateCurrentSpan("cache.operation", "invalidate")

				const request = new UserLookupCacheRequest({ externalId })

				yield* store.remove(request).pipe(
					Effect.mapError(
						(e) =>
							new UserLookupCacheError({
								message: "Failed to invalidate user lookup in cache",
								cause: e,
							}),
					),
				)

				yield* Effect.logDebug(`Invalidated cached user lookup: ${externalId}`)
			}).pipe(Effect.withSpan("UserLookupCache.invalidate"))

		return {
			get,
			set,
			invalidate,
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)

	static Test = Layer.mock(this, {
		get: (_externalId: string) => Effect.succeed(Option.none<UserLookupResult>()),
		set: (_externalId: string, _internalUserId: UserId) => Effect.void,
		invalidate: (_externalId: string) => Effect.void,
	})

	static TestWith = (options: { cachedResult?: UserLookupResult }) =>
		Layer.mock(UserLookupCache, {
			get: (_externalId: string) =>
				Effect.succeed(options.cachedResult ? Option.some(options.cachedResult) : Option.none()),
			set: (_externalId: string, _internalUserId: UserId) => Effect.void,
			invalidate: (_externalId: string) => Effect.void,
		})
}
