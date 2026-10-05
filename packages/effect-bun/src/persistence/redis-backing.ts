import { Persistence } from "effect/persistence"
import { Duration, Effect, Layer } from "effect"
import { identity } from "effect/Function"
import { Redis } from "../Redis.js"

const makePersistenceError = (method: string, error: unknown) =>
	new Persistence.PersistenceError({
		message: `Persistence error in ${method}`,
		cause: error,
	})

/**
 * Create a BackingPersistence using @hazel/effect-bun Redis service.
 * This is the core implementation that bridges Redis to Effect's Persistence system.
 */
export const makeRedisBackingPersistence = Effect.gen(function* () {
	const redis = yield* Redis

	return Persistence.BackingPersistence.of({
		make: (prefix) =>
			Effect.sync(() => {
				const prefixed = (key: string) => `${prefix}:${key}`

				const parse =
					(method: string) =>
					(str: string | null): Effect.Effect<object | undefined, Persistence.PersistenceError> => {
						if (str === null) return Effect.succeed(undefined)
						return Effect.try({
							try: () => JSON.parse(str) as object,
							catch: (error) => makePersistenceError(method, error),
						})
					}

				return identity<Persistence.BackingPersistenceStore>({
					get: (key) =>
						Effect.flatMap(
							redis
								.get(prefixed(key))
								.pipe(Effect.mapError((error) => makePersistenceError("get", error))),
							parse("get"),
						),

					getMany: (keys) =>
						redis.send<(string | null)[]>("MGET", keys.map(prefixed)).pipe(
							Effect.mapError((error) => makePersistenceError("getMany", error)),
							Effect.flatMap((results) => Effect.forEach(results, parse("getMany"))),
							Effect.map((results) => results as any),
						),

					set: (key, value, ttl) =>
						Effect.gen(function* () {
							const serialized = yield* Effect.try({
								try: () => JSON.stringify(value),
								catch: (error) => makePersistenceError("set", error),
							})

							const pkey = prefixed(key)
							if (ttl !== undefined) {
								// Atomic SET with PX (milliseconds) - sets value and TTL in single command
								yield* redis
									.send("SET", [pkey, serialized, "PX", String(Duration.toMillis(ttl))])
									.pipe(Effect.mapError((error) => makePersistenceError("set", error)))
							} else {
								yield* redis
									.set(pkey, serialized)
									.pipe(Effect.mapError((error) => makePersistenceError("set", error)))
							}
						}),

					setMany: (entries) =>
						Effect.gen(function* () {
							for (const [key, value, ttl] of entries) {
								const pkey = prefixed(key)
								const serialized = JSON.stringify(value)
								if (ttl !== undefined) {
									yield* redis
										.send("SET", [pkey, serialized, "PX", String(Duration.toMillis(ttl))])
										.pipe(
											Effect.mapError((error) =>
												makePersistenceError("setMany", error),
											),
										)
								} else {
									yield* redis
										.set(pkey, serialized)
										.pipe(
											Effect.mapError((error) =>
												makePersistenceError("setMany", error),
											),
										)
								}
							}
						}),

					remove: (key) =>
						redis
							.del(prefixed(key))
							.pipe(Effect.mapError((error) => makePersistenceError("remove", error))),

					clear: Effect.gen(function* () {
						const keys = yield* redis
							.send<string[]>("KEYS", [`${prefix}:*`])
							.pipe(Effect.mapError((error) => makePersistenceError("clear", error)))
						if (keys.length > 0) {
							yield* redis
								.send("DEL", keys)
								.pipe(Effect.mapError((error) => makePersistenceError("clear", error)))
						}
					}),
				})
			}),
	})
})

/**
 * Layer providing BackingPersistence using Redis.
 * Requires: Redis
 * Provides: Persistence.BackingPersistence
 */
export const RedisBackingPersistenceLive = Layer.effect(
	Persistence.BackingPersistence,
	makeRedisBackingPersistence,
)

/**
 * Layer providing Persistence using Redis backing.
 * Requires: Redis
 * Provides: Persistence.Persistence
 */
export const RedisResultPersistenceLive = Persistence.layer.pipe(Layer.provide(RedisBackingPersistenceLive))

/**
 * In-memory persistence layer for testing or fallback.
 * Provides: Persistence.Persistence
 */
export const MemoryResultPersistenceLive = Persistence.layerMemory
