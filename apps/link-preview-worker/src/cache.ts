import { Effect, Layer, Context } from "effect"

/**
 * Cache TTL in seconds (1 hour)
 */
const CACHE_TTL = 3600

/**
 * KV Cache Service
 * Provides caching functionality using Cloudflare KV
 */
export class KVCache extends Context.Service<
	KVCache,
	{
		get: <T>(key: string) => Effect.Effect<T | null, Error>
		set: <T>(key: string, value: T) => Effect.Effect<void, Error>
	}
>()("KVCache") {}

/**
 * Create a KV Cache Layer from a KV namespace binding
 */
export const makeKVCacheLayer = (kv: KVNamespace): Layer.Layer<KVCache> =>
	Layer.succeed(KVCache, {
		get: <T>(key: string): Effect.Effect<T | null, Error> =>
			Effect.tryPromise({
				try: async () => {
					const cached = await kv.get(key, "json")
					return (cached as T | null) ?? null
				},
				catch: (error) =>
					new Error(
						`KV get failed for key ${key}: ${error instanceof Error ? error.message : String(error)}`,
					),
			}),

		set: <T>(key: string, value: T): Effect.Effect<void, Error> =>
			Effect.tryPromise({
				try: async () => {
					await kv.put(key, JSON.stringify(value), {
						expirationTtl: CACHE_TTL,
					})
				},
				catch: (error) =>
					new Error(
						`KV set failed for key ${key}: ${error instanceof Error ? error.message : String(error)}`,
					),
			}),
	})
