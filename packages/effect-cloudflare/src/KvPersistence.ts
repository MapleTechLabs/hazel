import type { KVNamespace } from "@cloudflare/workers-types"
import { Duration, Effect, Layer } from "effect"
import { identity } from "effect/Function"
import { Persistence } from "effect/persistence"

/** Workers KV rejects `expirationTtl` below 60 seconds. */
const KV_MIN_TTL_SECONDS = 60

const persistenceError = (method: string, cause: unknown) =>
	new Persistence.PersistenceError({ message: `KV persistence error in ${method}`, cause })

const kvTtl = (ttl: Duration.Duration | undefined): { expirationTtl: number } | undefined =>
	ttl === undefined
		? undefined
		: { expirationTtl: Math.max(KV_MIN_TTL_SECONDS, Math.ceil(Duration.toSeconds(ttl))) }

/**
 * `BackingPersistence` over a Workers KV namespace. KV is eventually consistent (writes take up
 * to ~60s to reach other locations), which suits caches whose entries are TTL-bounded anyway.
 * Replaces the Redis backing on Workers.
 */
export const makeKvBackingPersistence = (kv: KVNamespace) =>
	Persistence.BackingPersistence.of({
		make: (prefix) =>
			Effect.sync(() => {
				const prefixed = (key: string) => `${prefix}:${key}`

				const get = (key: string) =>
					Effect.tryPromise({
						try: () => kv.get<object>(prefixed(key), "json"),
						catch: (cause) => persistenceError("get", cause),
					}).pipe(Effect.map((value) => value ?? undefined))

				const set = (key: string, value: object, ttl: Duration.Duration | undefined) =>
					Effect.tryPromise({
						try: () => kv.put(prefixed(key), JSON.stringify(value), kvTtl(ttl)),
						catch: (cause) => persistenceError("set", cause),
					})

				return identity<Persistence.BackingPersistenceStore>({
					get,
					getMany: (keys) =>
						Effect.forEach(keys, get, { concurrency: "unbounded" }) as Effect.Effect<
							any,
							Persistence.PersistenceError
						>,
					set,
					setMany: (entries) =>
						Effect.forEach(entries, ([key, value, ttl]) => set(key, value, ttl), {
							concurrency: "unbounded",
							discard: true,
						}),
					remove: (key) =>
						Effect.tryPromise({
							try: () => kv.delete(prefixed(key)),
							catch: (cause) => persistenceError("remove", cause),
						}),
					clear: Effect.gen(function* () {
						let cursor: string | undefined
						do {
							const page = yield* Effect.tryPromise({
								try: () => kv.list({ prefix: `${prefix}:`, cursor }),
								catch: (cause) => persistenceError("clear", cause),
							})
							yield* Effect.forEach(
								page.keys,
								(entry) =>
									Effect.tryPromise({
										try: () => kv.delete(entry.name),
										catch: (cause) => persistenceError("clear", cause),
									}),
								{ concurrency: 16, discard: true },
							)
							cursor = page.list_complete ? undefined : page.cursor
						} while (cursor !== undefined)
					}),
				})
			}),
	})

export const layerKvBackingPersistence = (kv: KVNamespace): Layer.Layer<Persistence.BackingPersistence> =>
	Layer.succeed(Persistence.BackingPersistence, makeKvBackingPersistence(kv))

/** `Persistence` (result persistence) backed by Workers KV. */
export const layerKvResultPersistence = (kv: KVNamespace): Layer.Layer<Persistence.Persistence> =>
	Persistence.layer.pipe(Layer.provide(layerKvBackingPersistence(kv)))
