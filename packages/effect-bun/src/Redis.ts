import { RedisClient } from "bun"
import { Config, Duration, Effect, Layer, Match, Schema, Context } from "effect"

// ============ Error Types ============

/**
 * Base Redis error - used for unknown error codes
 */
export class RedisError extends Schema.TaggedError<RedisError>()("RedisError", {
	message: Schema.String,
	code: Schema.optional(Schema.String),
	cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * Connection to Redis server was closed
 * Bun error code: ERR_REDIS_CONNECTION_CLOSED
 */
export class RedisConnectionClosedError extends Schema.TaggedError<RedisConnectionClosedError>()(
	"RedisConnectionClosedError",
	{
		message: Schema.String,
	},
) {}

/**
 * Failed to authenticate with Redis server
 * Bun error code: ERR_REDIS_AUTHENTICATION_FAILED
 */
export class RedisAuthenticationError extends Schema.TaggedError<RedisAuthenticationError>()(
	"RedisAuthenticationError",
	{
		message: Schema.String,
	},
) {}

/**
 * Received an invalid response from Redis server
 * Bun error code: ERR_REDIS_INVALID_RESPONSE
 */
export class RedisInvalidResponseError extends Schema.TaggedError<RedisInvalidResponseError>()(
	"RedisInvalidResponseError",
	{
		message: Schema.String,
	},
) {}

/**
 * Union type for all Redis errors
 */
export type RedisErrors =
	| RedisError
	| RedisConnectionClosedError
	| RedisAuthenticationError
	| RedisInvalidResponseError

/**
 * Map Bun Redis error codes to typed Effect errors
 */
const mapRedisError = (error: unknown): RedisErrors => {
	const e = error as Error & { code?: string }
	const message = e.message ?? String(error)

	return Match.value(e.code).pipe(
		Match.when("ERR_REDIS_CONNECTION_CLOSED", () => new RedisConnectionClosedError({ message })),
		Match.when("ERR_REDIS_AUTHENTICATION_FAILED", () => new RedisAuthenticationError({ message })),
		Match.when("ERR_REDIS_INVALID_RESPONSE", () => new RedisInvalidResponseError({ message })),
		Match.orElse((code) => new RedisError({ message, code, cause: error })),
	)
}

const sanitizeRedisUrl = (url: string): string => url.replace(/\/\/.*@/, "//***@")

// ============ Service ============

/**
 * Effect service for Bun's native Redis client.
 *
 * Uses environment variables for connection (auto-detected by Bun):
 * - REDIS_URL (default: redis://localhost:6379)
 * - VALKEY_URL (alternative)
 *
 * @example
 * ```typescript
 * import { Redis } from "@hazel/effect-bun"
 *
 * const program = Effect.gen(function* () {
 *   const redis = yield* Redis
 *   yield* redis.set("key", "value")
 *   const value = yield* redis.get("key")
 *   return value
 * }).pipe(Effect.provide(Redis.layer))
 * ```
 */
export class Redis extends Context.Service<
	Redis,
	{
		// String operations
		/**
		 * Get the value of a key
		 */
		readonly get: (key: string) => Effect.Effect<string | null, RedisErrors>
		/**
		 * Get the value of a key as Uint8Array
		 */
		readonly getBuffer: (key: string) => Effect.Effect<Uint8Array | null, RedisErrors>
		/**
		 * Set the value of a key
		 */
		readonly set: (key: string, value: string | number | Uint8Array) => Effect.Effect<void, RedisErrors>
		/**
		 * Delete a key
		 */
		readonly del: (key: string) => Effect.Effect<void, RedisErrors>
		/**
		 * Check if a key exists
		 */
		readonly exists: (key: string) => Effect.Effect<boolean, RedisErrors>
		/**
		 * Set a key's time to live in seconds
		 */
		readonly expire: (key: string, seconds: number) => Effect.Effect<void, RedisErrors>
		/**
		 * Get the time to live for a key in seconds
		 */
		readonly ttl: (key: string) => Effect.Effect<number, RedisErrors>

		// Numeric operations
		/**
		 * Increment the integer value of a key by one
		 */
		readonly incr: (key: string) => Effect.Effect<number, RedisErrors>
		/**
		 * Decrement the integer value of a key by one
		 */
		readonly decr: (key: string) => Effect.Effect<number, RedisErrors>

		// Hash operations
		/**
		 * Get the value of a hash field
		 */
		readonly hget: (key: string, field: string) => Effect.Effect<string | null, RedisErrors>
		/**
		 * Get the values of multiple hash fields
		 */
		readonly hmget: (key: string, fields: string[]) => Effect.Effect<(string | null)[], RedisErrors>
		/**
		 * Set multiple hash fields to multiple values
		 */
		readonly hmset: (key: string, fieldValues: string[]) => Effect.Effect<void, RedisErrors>
		/**
		 * Increment the integer value of a hash field by the given number
		 */
		readonly hincrby: (
			key: string,
			field: string,
			increment: number,
		) => Effect.Effect<number, RedisErrors>
		/**
		 * Increment the float value of a hash field by the given amount
		 */
		readonly hincrbyfloat: (
			key: string,
			field: string,
			increment: number,
		) => Effect.Effect<number, RedisErrors>

		// Set operations
		/**
		 * Add a member to a set
		 */
		readonly sadd: (key: string, member: string) => Effect.Effect<number, RedisErrors>
		/**
		 * Remove a member from a set
		 */
		readonly srem: (key: string, member: string) => Effect.Effect<number, RedisErrors>
		/**
		 * Check if a member exists in a set
		 */
		readonly sismember: (key: string, member: string) => Effect.Effect<boolean, RedisErrors>
		/**
		 * Get all members of a set
		 */
		readonly smembers: (key: string) => Effect.Effect<string[], RedisErrors>

		// Pub/Sub
		/**
		 * Publish a message to a channel
		 */
		readonly publish: (channel: string, message: string) => Effect.Effect<number, RedisErrors>
		/**
		 * Subscribe to a channel and receive messages.
		 * Creates a dedicated connection for subscriptions.
		 * Returns an unsubscribe function to clean up.
		 *
		 * @param channel - The channel to subscribe to
		 * @param handler - Callback invoked for each message (receives message and channel)
		 * @returns Effect that resolves to an object with unsubscribe method
		 *
		 * @example
		 * ```typescript
		 * const { unsubscribe } = yield* redis.subscribe("my-channel", (message, channel) => {
		 *   console.log(`Received: ${message} on ${channel}`)
		 * })
		 * // Later, to clean up:
		 * yield* unsubscribe
		 * ```
		 */
		readonly subscribe: (
			channel: string,
			handler: (message: string, channel: string) => void,
		) => Effect.Effect<{ unsubscribe: Effect.Effect<void, RedisErrors> }, RedisErrors>

		// Raw command
		/**
		 * Execute any Redis command
		 */
		readonly send: <T = unknown>(command: string, args: string[]) => Effect.Effect<T, RedisErrors>

		// Connection info
		/**
		 * Check if connected to Redis
		 */
		readonly connected: boolean
	}
>()("@hazel/effect-bun/Redis") {
	/**
	 * Create a Redis layer with a specific URL
	 */
	static readonly layer = (url: string) =>
		Layer.effect(
			Redis,
			Effect.gen(function* () {
				const client = new RedisClient(url)

				yield* Effect.tryPromise({
					try: () => client.connect(),
					catch: mapRedisError,
				}).pipe(
					Effect.timeoutOrElse({
						duration: Duration.seconds(10),
						orElse: () =>
							Effect.fail(
								new RedisError({
									message: `Redis connection timed out after 10s (url: ${sanitizeRedisUrl(url)})`,
								}),
							),
					}),
				)

				yield* Effect.log(`Redis connected: ${sanitizeRedisUrl(url)}`)

				yield* Effect.addFinalizer(() =>
					Effect.sync(() => {
						client.close()
					}),
				)

				return makeService(client, url)
			}),
		)

	/**
	 * Default Redis layer using REDIS_URL environment variable
	 */
	static readonly Default = Layer.effect(
		Redis,
		Effect.gen(function* () {
			const url = yield* Config.String("REDIS_URL").pipe(Config.withDefault("redis://localhost:6379"))
			const client = new RedisClient(url)

			yield* Effect.tryPromise({
				try: () => client.connect(),
				catch: mapRedisError,
			}).pipe(
				Effect.timeoutOrElse({
					duration: Duration.seconds(10),
					orElse: () =>
						Effect.fail(
							new RedisError({
								message: `Redis connection timed out after 10s (url: ${sanitizeRedisUrl(url)})`,
							}),
						),
				}),
			)

			yield* Effect.log(`Redis connected: ${sanitizeRedisUrl(url)}`)

			yield* Effect.addFinalizer(() =>
				Effect.sync(() => {
					client.close()
				}),
			)

			return makeService(client, url)
		}),
	)
}

/**
 * Create the Redis service implementation from a connected client
 */
const makeService = (client: RedisClient, url: string): Context.Service.Shape<typeof Redis> => ({
	// String operations
	get: (key) =>
		Effect.tryPromise({
			try: () => client.get(key),
			catch: mapRedisError,
		}),
	getBuffer: (key) =>
		Effect.tryPromise({
			try: () => client.getBuffer(key),
			catch: mapRedisError,
		}),
	set: (key, value) =>
		Effect.tryPromise({
			try: () => client.set(key, String(value)),
			catch: mapRedisError,
		}).pipe(Effect.asVoid),
	del: (key) =>
		Effect.tryPromise({
			try: () => client.del(key),
			catch: mapRedisError,
		}).pipe(Effect.asVoid),
	exists: (key) =>
		Effect.tryPromise({
			try: () => client.exists(key),
			catch: mapRedisError,
		}),
	expire: (key, seconds) =>
		Effect.tryPromise({
			try: () => client.expire(key, seconds),
			catch: mapRedisError,
		}).pipe(Effect.asVoid),
	ttl: (key) =>
		Effect.tryPromise({
			try: () => client.ttl(key),
			catch: mapRedisError,
		}),

	// Numeric operations
	incr: (key) =>
		Effect.tryPromise({
			try: () => client.incr(key),
			catch: mapRedisError,
		}),
	decr: (key) =>
		Effect.tryPromise({
			try: () => client.decr(key),
			catch: mapRedisError,
		}),

	// Hash operations
	hget: (key, field) =>
		Effect.tryPromise({
			try: () => client.hget(key, field),
			catch: mapRedisError,
		}),
	hmget: (key, fields) =>
		Effect.tryPromise({
			try: () => client.hmget(key, fields),
			catch: mapRedisError,
		}),
	hmset: (key, fieldValues) =>
		Effect.tryPromise({
			try: () => client.hmset(key, fieldValues),
			catch: mapRedisError,
		}).pipe(Effect.asVoid),
	hincrby: (key, field, increment) =>
		Effect.tryPromise({
			try: () => client.hincrby(key, field, increment),
			catch: mapRedisError,
		}),
	hincrbyfloat: (key, field, increment) =>
		Effect.tryPromise({
			try: () => client.hincrbyfloat(key, field, increment),
			catch: mapRedisError,
		}).pipe(Effect.map((v) => Number(v))),

	// Set operations
	sadd: (key, member) =>
		Effect.tryPromise({
			try: () => client.sadd(key, member),
			catch: mapRedisError,
		}),
	srem: (key, member) =>
		Effect.tryPromise({
			try: () => client.srem(key, member),
			catch: mapRedisError,
		}),
	sismember: (key, member) =>
		Effect.tryPromise({
			try: () => client.sismember(key, member),
			catch: mapRedisError,
		}),
	smembers: (key) =>
		Effect.tryPromise({
			try: () => client.smembers(key),
			catch: mapRedisError,
		}),

	// Pub/Sub
	publish: (channel, message) =>
		Effect.tryPromise({
			try: () => client.publish(channel, message),
			catch: mapRedisError,
		}),

	subscribe: (channel, handler) =>
		Effect.gen(function* () {
			// Create a dedicated client for subscriptions
			// (Redis requires separate connections for pub/sub mode)
			const subscriberClient = new RedisClient(url)

			yield* Effect.tryPromise({
				try: () => subscriberClient.connect(),
				catch: mapRedisError,
			})

			yield* Effect.tryPromise({
				try: () =>
					subscriberClient.subscribe(channel, (message, chan) => {
						handler(message, chan)
					}),
				catch: mapRedisError,
			})

			return {
				unsubscribe: Effect.tryPromise({
					try: async () => {
						await subscriberClient.unsubscribe(channel)
						subscriberClient.close()
					},
					catch: mapRedisError,
				}).pipe(Effect.asVoid),
			}
		}),

	// Raw command
	send: <T = unknown>(command: string, args: string[]) =>
		Effect.tryPromise({
			try: () => client.send(command, args) as Promise<T>,
			catch: mapRedisError,
		}),

	// Connection info
	get connected() {
		return client.connected
	},
})
