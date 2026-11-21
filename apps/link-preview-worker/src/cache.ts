import { Context, Effect, Layer, Schema } from "effect"

/**
 * Cache TTL in seconds (1 hour)
 */
const CACHE_TTL = 3600

/** A KV read or write failed. Callers treat the cache as best-effort. */
export class KVCacheError extends Schema.TaggedError<KVCacheError, { readonly brand: unique symbol }>()(
	"KVCacheError",
	{
		message: Schema.String,
	},
) {}

const kvFailure = (operation: "get" | "set", key: string, error: unknown) =>
	new KVCacheError({
		message: `KV ${operation} failed for key ${key}: ${error instanceof Error ? error.message : String(error)}`,
	})

/**
 * KV Cache Service
 * Provides caching functionality using Cloudflare KV
 */
export class KVCache extends Context.Service<
	KVCache,
	{
		get: <T>(key: string) => Effect.Effect<T | null, KVCacheError>
		set: <T>(key: string, value: T) => Effect.Effect<void, KVCacheError>
	}
>()("KVCache") {}

/**
 * Create a KV Cache Layer from a KV namespace binding
 */
export const makeKVCacheLayer = (kv: KVNamespace): Layer.Layer<KVCache> =>
	Layer.succeed(KVCache, {
		get: <T>(key: string): Effect.Effect<T | null, KVCacheError> =>
			Effect.tryPromise({
				try: async () => {
					const cached = await kv.get(key, "json")
					return (cached as T | null) ?? null
				},
				catch: (error) => kvFailure("get", key, error),
			}),

		set: <T>(key: string, value: T): Effect.Effect<void, KVCacheError> =>
			Effect.tryPromise({
				try: async () => {
					await kv.put(key, JSON.stringify(value), {
						expirationTtl: CACHE_TTL,
					})
				},
				catch: (error) => kvFailure("set", key, error),
			}),
	})
